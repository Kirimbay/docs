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
  const renameDialog = $("#rename-dialog");
  const renameInput = $("#rename-input");
  const renameRandomBtn = $("#rename-random-btn");
  const renameCancelBtn = $("#rename-cancel-btn");
  const renameApplyBtn = $("#rename-apply-btn");
  const meBtn = $("#me-btn");
  const themeBtn = $("#theme-btn");
  const dmBtn = $("#dm-btn");
  const dmBar = $("#dm-bar");
  const dmBarCode = $("#dm-bar-code");
  const dmBarPresence = $("#dm-bar-presence");
  const dmCopyBtn = $("#dm-copy-btn");
  const dmDialog = $("#dm-dialog");
  const dmCreateBtn = $("#dm-create-btn");
  const dmJoinBtn = $("#dm-join-btn");
  const dmCodeInput = $("#dm-code-input");
  const dmDialogError = $("#dm-dialog-error");
  const dmDialogClose = $("#dm-dialog-close");
  const dmCreatedBox = $("#dm-created-box");
  const dmCreatedCode = $("#dm-created-code");
  const dmRoomsWrap = $("#dm-rooms-wrap");
  const dmRoomsList = $("#dm-rooms-list");
  const onlineDialog = $("#online-dialog");
  const onlineList = $("#online-list");
  const onlineCloseBtn = $("#online-close-btn");
  const inviteBanner = $("#invite-banner");
  const inviteFrom = $("#invite-from");
  const inviteAccept = $("#invite-accept");
  const inviteDecline = $("#invite-decline");
  const adminDialog = $("#admin-dialog");
  const adminPassword = $("#admin-password");
  const adminError = $("#admin-error");
  const adminSubmit = $("#admin-submit");
  const adminCancelBtn = $("#admin-cancel-btn");
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightbox-img");

  const socket = io({ autoConnect: true });
  const NAME_KEY = "sarafan_name";
  const NAME_KEY_LEGACY = "komnata_name";
  const DM_CODE_KEY = "sarafan_dm_code";
  const DM_ROOMS_KEY = "sarafan_dm_rooms";
  const MAX_DM_ROOMS = 24;
  const ADMIN_TOKEN_KEY = "sarafan_admin_token";
  const PREV_NAME_KEY = "sarafan_prev_name";
  const THEME_KEY = "sarafan_theme";
  const LIKE_EMOJI = "❤️";
  const REACTIONS = [
    { emoji: "😊", title: "смайл" },
    { emoji: LIKE_EMOJI, title: "любовь" },
    { emoji: "😢", title: "грусть" },
    { emoji: "💩", title: "говно" },
    { emoji: "🔥", title: "огонь" },
  ];

  function systemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "dark";
    }
  }

  function loadStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : null;
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  function effectiveTheme() {
    return loadStoredTheme() || systemTheme();
  }

  function applyTheme(theme, { persist = false } = {}) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === "light" ? "#f2f1ee" : "#121314";
    if (themeBtn) {
      themeBtn.title = next === "light" ? "Тёмная тема" : "Светлая тема";
      themeBtn.setAttribute("aria-label", themeBtn.title);
    }
    if (persist) saveTheme(next);
  }

  function toggleTheme() {
    const next = effectiveTheme() === "light" ? "dark" : "light";
    applyTheme(next, { persist: true });
  }

  applyTheme(effectiveTheme());
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (loadStoredTheme()) return;
      applyTheme(systemTheme());
    });
  } catch {
    /* ignore */
  }

  let myName = "";
  let isAdmin = false;
  let pendingImageUrl = null;
  let uploading = false;
  let pendingReply = null;
  const knownIds = new Set();
  let lastState = { messages: [], pinned: [] };
  /** @type {{ id: string, name: string }[]} */
  let lastPeople = [];
  let lastPresenceCount = 0;
  let pendingInvite = null;
  let publicStateBackup = null;
  let dmCode = null;
  let pinCycleIndex = 0;
  let pinHoldTimer = null;
  let pinHoldOpened = false;
  let pinHoldStart = null;
  const PIN_HOLD_MS = 420;
  const PIN_HOLD_MOVE_PX = 12;
  const MSG_HOLD_MS = 420;
  const MSG_HOLD_MOVE_PX = 12;
  let deleteArmedId = null;
  let deleteArmedTimer = null;
  const DELETE_ARM_MS = 1000;
  let unpinArmedId = null;
  let unpinArmedTimer = null;
  const UNPIN_ARM_MS = 1000;

  function clearDeleteArm() {
    if (deleteArmedTimer) {
      clearTimeout(deleteArmedTimer);
      deleteArmedTimer = null;
    }
    deleteArmedId = null;
    document.querySelectorAll(".msg-delete.armed").forEach((btn) => {
      btn.classList.remove("armed");
      btn.title = "Нажмите дважды, чтобы удалить";
    });
  }

  function clearUnpinArm() {
    if (unpinArmedTimer) {
      clearTimeout(unpinArmedTimer);
      unpinArmedTimer = null;
    }
    unpinArmedId = null;
    document.querySelectorAll(".pins-unpin.armed").forEach((btn) => {
      btn.classList.remove("armed");
      btn.title = "Нажмите дважды, чтобы открепить";
    });
  }

  function loadSavedName() {
    try {
      const next = (localStorage.getItem(NAME_KEY) || "").trim().slice(0, 24);
      if (next) return next;
      const legacy = (localStorage.getItem(NAME_KEY_LEGACY) || "").trim().slice(0, 24);
      if (legacy) {
        localStorage.setItem(NAME_KEY, legacy);
        return legacy;
      }
      return "";
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

  function normalizeDmCodeLocal(raw) {
    return String(raw || "").replace(/\D/g, "").slice(0, 6);
  }

  function loadDmCode() {
    try {
      return normalizeDmCodeLocal(localStorage.getItem(DM_CODE_KEY) || "");
    } catch {
      return "";
    }
  }

  function saveDmCode(code) {
    const c = normalizeDmCodeLocal(code);
    try {
      if (c.length === 6) localStorage.setItem(DM_CODE_KEY, c);
      else localStorage.removeItem(DM_CODE_KEY);
    } catch {
      /* ignore */
    }
  }

  function loadDmRooms() {
    /** @type {{ code: string, lastAt: number }[]} */
    let rooms = [];
    try {
      const raw = localStorage.getItem(DM_ROOMS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          rooms = parsed
            .map((item) => ({
              code: normalizeDmCodeLocal(item?.code),
              lastAt: Number(item?.lastAt) || 0,
            }))
            .filter((item) => item.code.length === 6);
        }
      }
    } catch {
      rooms = [];
    }
    const legacy = loadDmCode();
    if (legacy.length === 6 && !rooms.some((r) => r.code === legacy)) {
      rooms.unshift({ code: legacy, lastAt: Date.now() });
    }
    rooms.sort((a, b) => b.lastAt - a.lastAt);
    const seen = new Set();
    const uniq = [];
    for (const r of rooms) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      uniq.push(r);
    }
    return uniq.slice(0, MAX_DM_ROOMS);
  }

  function saveDmRooms(rooms) {
    try {
      localStorage.setItem(
        DM_ROOMS_KEY,
        JSON.stringify(
          (rooms || [])
            .filter((r) => r?.code && String(r.code).length === 6)
            .slice(0, MAX_DM_ROOMS)
        )
      );
    } catch {
      /* ignore */
    }
  }

  function rememberDmRoom(code, { active = true } = {}) {
    const c = normalizeDmCodeLocal(code);
    if (c.length !== 6) return;
    const rooms = loadDmRooms().filter((r) => r.code !== c);
    rooms.unshift({ code: c, lastAt: Date.now() });
    saveDmRooms(rooms);
    if (active) saveDmCode(c);
  }

  function forgetDmRoom(code) {
    const c = normalizeDmCodeLocal(code);
    if (!c) return;
    saveDmRooms(loadDmRooms().filter((r) => r.code !== c));
    if (loadDmCode() === c) saveDmCode("");
  }

  function joinDmByCode(code, { fromList = false } = {}) {
    showDmDialogError("");
    const c = normalizeDmCodeLocal(code);
    if (dmCodeInput) dmCodeInput.value = c;
    if (c.length !== 6) {
      showDmDialogError("Нужен код из 6 цифр");
      return;
    }
    socket.emit("dm:join", { code: c }, (res) => {
      if (!res?.ok) {
        const err = res?.error || "Не удалось войти";
        showDmDialogError(err);
        if (/не найдена|проверьте код/i.test(err)) {
          forgetDmRoom(c);
          renderDmRoomsList();
        }
        return;
      }
      rememberDmRoom(c);
      enterDmMode(res);
      dmDialog?.close();
    });
  }

  function renderDmRoomsList() {
    if (!dmRoomsList || !dmRoomsWrap) return;
    const rooms = loadDmRooms();
    dmRoomsList.replaceChildren();
    if (!rooms.length) {
      dmRoomsWrap.hidden = true;
      return;
    }
    dmRoomsWrap.hidden = false;
    for (const room of rooms) {
      const row = document.createElement("div");
      row.className = "dm-room-row";
      row.setAttribute("role", "listitem");

      const enterBtn = document.createElement("button");
      enterBtn.type = "button";
      enterBtn.className = "dm-room-enter";
      enterBtn.title = `Войти в чат ${room.code}`;

      const codeEl = document.createElement("strong");
      codeEl.className = "dm-room-code";
      codeEl.textContent = room.code;

      const hint = document.createElement("span");
      hint.className = "dm-room-hint";
      hint.textContent = "история сохранена";

      enterBtn.append(codeEl, hint);
      enterBtn.addEventListener("click", () => joinDmByCode(room.code, { fromList: true }));

      const forgetBtn = document.createElement("button");
      forgetBtn.type = "button";
      forgetBtn.className = "dm-room-forget ghost compact";
      forgetBtn.setAttribute("aria-label", `Убрать ${room.code} из списка`);
      forgetBtn.title = "Убрать из списка";
      forgetBtn.textContent = "×";
      forgetBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        forgetDmRoom(room.code);
        renderDmRoomsList();
      });

      row.append(enterBtn, forgetBtn);
      dmRoomsList.append(row);
    }
  }

  function loadAdminToken() {
    try {
      return (localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function saveAdminToken(token) {
    try {
      if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
      else localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function clearAdminToken() {
    saveAdminToken("");
  }

  function loadPrevName() {
    try {
      return (localStorage.getItem(PREV_NAME_KEY) || "").trim().slice(0, 24);
    } catch {
      return "";
    }
  }

  function savePrevName(name) {
    const n = (name || "").trim().slice(0, 24);
    if (!n || n === "АДМИН") return;
    try {
      localStorage.setItem(PREV_NAME_KEY, n);
    } catch {
      /* ignore */
    }
  }

  function clearPrevName() {
    try {
      localStorage.removeItem(PREV_NAME_KEY);
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
    dmBarPresence.textContent = `${n}/2`;
  }

  function enterDmMode(res) {
    if (!res?.ok || !res.code) return;
    if (!dmCode) publicStateBackup = { messages: [...(lastState.messages || [])], pinned: [...(lastState.pinned || [])] };
    dmCode = res.code;
    rememberDmRoom(res.code);
    document.body.classList.add("dm-on");
    if (dmBar) dmBar.hidden = false;
    if (dmBarCode) dmBarCode.textContent = res.code;
    if (dmCreatedBox && dmCreatedCode) {
      dmCreatedBox.hidden = false;
      dmCreatedCode.textContent = res.code;
    }
    clearReply();
    pinToLatestOnce = true;
    renderAll({ messages: res.messages || [], pinned: [] });
    schedulePinToLatest();
    updateDmPresence(res);
    if (messageInput) messageInput.placeholder = "Сообщение вдвоём…";
    composerHint.textContent = res.invited
      ? `Ждём ${res.invited} · код ${res.code}`
      : `Код ${res.code} · передайте второму`;
    syncDmBtn();
  }

  function leaveDmMode() {
    const prev = dmCode;
    dmCode = null;
    // Keep room in the saved list; only clear "active session" code.
    saveDmCode("");
    document.body.classList.remove("dm-on");
    if (dmBar) dmBar.hidden = true;
    if (messageInput) messageInput.placeholder = "Написать сообщение…";
    clearReply();
    pinToLatestOnce = true;
    socket.emit("dm:leave", {}, () => {
      /* chat:state follows from server */
    });
    syncDmBtn();
    if (prev) {
      rememberDmRoom(prev, { active: false });
      saveDmCode("");
      composerHint.textContent = `Снова общий чат · ${prev} в меню «Вдвоём»`;
    }
  }

  function openDmDialog() {
    if (!dmDialog) return;
    showDmDialogError("");
    if (dmCreatedBox) dmCreatedBox.hidden = true;
    renderDmRoomsList();
    if (dmCodeInput) dmCodeInput.value = "";
    dmDialog.showModal();
    layoutDmDialog();
    keepDialogAboveKeyboard(dmDialog, dmCodeInput);
    const rooms = loadDmRooms();
    if (!rooms.length) dmCodeInput?.focus();
  }

  function updatePresenceChrome() {
    if (!presence) return;
    const n = lastPresenceCount;
    presence.textContent = n ? `онлайн ${n}` : "онлайн —";
    presence.title = n ? "Нажмите — кто онлайн" : "Пока никого";
  }

  function layoutBottomSheet(dialog) {
    if (!dialog?.open) return;
    syncViewportHeight();
    const vv = window.visualViewport;
    const vvH = vv ? Math.round(vv.height) : Math.round(window.innerHeight);
    const vvBottom = vv ? Math.round((vv.offsetTop || 0) + vv.height) : vvH;
    const sidePad = 10;
    const bottomPad = 10;
    const maxSheet = Math.round(vvH * 0.5);
    const bottomInset = Math.max(0, Math.round(window.innerHeight - vvBottom));
    dialog.style.top = "auto";
    dialog.style.left = "50%";
    dialog.style.right = "auto";
    dialog.style.bottom = `${bottomInset + bottomPad}px`;
    dialog.style.transform = "translateX(-50%)";
    dialog.style.width = `min(420px, calc(100vw - ${sidePad * 2}px))`;
    dialog.style.maxWidth = `calc(100vw - ${sidePad * 2}px)`;
    dialog.style.maxHeight = `${maxSheet}px`;
    dialog.style.height = "auto";
  }

  function closeOnlineList() {
    if (onlineDialog?.open) onlineDialog.close();
  }

  function invitePerson(person) {
    if (!person?.id || person.name === myName) return;
    closeOnlineList();
    socket.emit("dm:invite", { toId: person.id }, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не удалось пригласить";
        return;
      }
      enterDmMode(res);
      composerHint.textContent = `Приглашение ${person.name} · код ${res.code}`;
    });
  }

  function renderOnlineList() {
    if (!onlineList) return;
    const others = lastPeople.filter((p) => p.name && p.name !== myName);
    const prevFocus = onlineList.querySelector(":focus")?.dataset?.id || "";
    onlineList.replaceChildren();
    if (!others.length) {
      const empty = document.createElement("p");
      empty.className = "user-list-empty";
      empty.textContent = lastPresenceCount <= 1 ? "Вы одни онлайн" : "Никого кроме вас";
      onlineList.append(empty);
      return;
    }
    others
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .forEach((person) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "online-row";
        row.setAttribute("role", "option");
        row.dataset.id = person.id;
        const name = document.createElement("span");
        name.className = "online-row-name";
        name.textContent = person.name;
        const action = document.createElement("span");
        action.className = "online-row-action";
        action.textContent = "пригласить";
        row.append(name, action);
        row.addEventListener("click", () => invitePerson(person));
        onlineList.append(row);
        if (person.id === prevFocus) row.focus({ preventScroll: true });
      });
  }

  function openOnlineList() {
    if (!onlineDialog || !myName) return;
    syncViewportHeight();
    renderOnlineList();
    if (!onlineDialog.open) onlineDialog.showModal();
    layoutBottomSheet(onlineDialog);
  }

  function hideInviteBanner() {
    pendingInvite = null;
    if (!inviteBanner) return;
    inviteBanner.classList.remove("is-visible");
    const finish = () => {
      if (!inviteBanner.classList.contains("is-visible")) inviteBanner.hidden = true;
    };
    inviteBanner.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 320);
  }

  function showInviteBanner(invite) {
    pendingInvite = invite;
    if (!inviteBanner || !inviteFrom) return;
    inviteFrom.textContent = invite.from || "Кто-то";
    inviteBanner.hidden = false;
    requestAnimationFrame(() => {
      inviteBanner.classList.add("is-visible");
    });
  }

  function acceptInvite() {
    const invite = pendingInvite;
    hideInviteBanner();
    if (!invite?.code) return;
    socket.emit("dm:join", { code: invite.code }, (res) => {
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не удалось войти";
        return;
      }
      enterDmMode(res);
      composerHint.textContent = `Вдвоём с ${invite.from || "участником"}`;
    });
  }

  function declineInvite() {
    const invite = pendingInvite;
    hideInviteBanner();
    if (invite?.fromId) {
      socket.emit("dm:invite-decline", { fromId: invite.fromId });
    }
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

  let jumpBottomRaf = 0;
  function updateJumpBottom() {
    if (jumpBottomRaf) return;
    jumpBottomRaf = requestAnimationFrame(() => {
      jumpBottomRaf = 0;
      jumpBottomBtn.hidden = isNearBottom(180);
    });
  }

  /** Softens discrete mouse-wheel jumps in Chrome (trackpad stays pixel-smooth). */
  function createSmoothScroller(el) {
    let target = el.scrollTop;
    let current = el.scrollTop;
    let raf = 0;
    let animating = false;
    const ease = 0.2;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const clamp = (y) => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      return Math.max(0, Math.min(max, y));
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      animating = false;
    };

    const tick = () => {
      raf = 0;
      const diff = target - current;
      if (Math.abs(diff) < 0.45) {
        current = target;
        el.scrollTop = current;
        animating = false;
        return;
      }
      current += diff * ease;
      el.scrollTop = current;
      raf = requestAnimationFrame(tick);
    };

    const setTarget = (y, { animate = true } = {}) => {
      target = clamp(y);
      if (!animate || reduceMotion.matches) {
        stop();
        current = target;
        el.scrollTop = target;
        return;
      }
      current = el.scrollTop;
      animating = true;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    el.addEventListener(
      "wheel",
      (e) => {
        if (reduceMotion.matches || e.ctrlKey) return;
        if (el.scrollHeight <= el.clientHeight + 1) return;

        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= el.clientHeight;

        // Discrete notches feel harsh — blend them into a glide.
        if (e.deltaMode === 1 || Math.abs(e.deltaY) >= 40) dy *= 0.65;

        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const from = animating ? target : el.scrollTop;
        const next = clamp(from + dy);
        if (
          next === from &&
          ((dy < 0 && el.scrollTop <= 0) || (dy > 0 && el.scrollTop >= max - 0.5))
        ) {
          return;
        }

        e.preventDefault();
        setTarget(next, { animate: true });
      },
      { passive: false }
    );

    el.addEventListener(
      "scroll",
      () => {
        if (!animating) {
          target = el.scrollTop;
          current = el.scrollTop;
        }
      },
      { passive: true }
    );

    return {
      scrollTo(y, smooth = true) {
        setTarget(y, { animate: smooth });
      },
      refresh() {
        if (!animating) {
          target = el.scrollTop;
          current = el.scrollTop;
        }
      },
    };
  }

  const feedScroller = createSmoothScroller(feed);
  let pinToLatestOnce = false;

  function scrollFeedToBottom(smooth = true) {
    const max = Math.max(0, feed.scrollHeight - feed.clientHeight);
    if (!smooth) {
      // Instant jump — bypass clamp race while the feed is still laying out.
      feed.scrollTop = max;
      feedScroller.refresh();
    } else {
      feedScroller.scrollTo(max, true);
    }
    jumpBottomBtn.hidden = true;
  }

  function schedulePinToLatest() {
    pinToLatestOnce = true;
    const run = () => {
      if (app.hidden) return;
      scrollFeedToBottom(false);
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    setTimeout(run, 60);
    setTimeout(run, 220);
    setTimeout(run, 480);
    // Photos / viewport chrome often grow the feed after the first jump.
    feed.querySelectorAll("img.msg-photo").forEach((img) => {
      if (img.complete) return;
      img.addEventListener("load", run, { once: true });
    });
  }

  function lockPageScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function syncViewportHeight() {
    // Avoid layout thrash / backdrop flicker while viewing a zoomed photo.
    if (lightbox?.open) return;

    const vv = window.visualViewport;
    const active = document.activeElement;
    const focused =
      active === messageInput ||
      active === nameInput ||
      active === renameInput ||
      active === adminPassword ||
      active === dmCodeInput ||
      active?.tagName === "TEXTAREA" ||
      active?.tagName === "INPUT";

    let height = window.innerHeight;
    let inset = 0;
    if (vv) {
      height = Math.round(vv.height);
      const rawInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      inset = focused && rawInset > 60 ? rawInset : 0;
      document.documentElement.style.setProperty("--vv-top", `${Math.round(vv.offsetTop || 0)}px`);
    } else {
      document.documentElement.style.setProperty("--vv-top", "0px");
    }

    document.documentElement.style.setProperty("--app-height", `${height}px`);
    document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
    document.body.classList.toggle("keyboard-open", inset > 80);
    lockPageScroll();
  }

  let adminSheetFrozen = false;

  function layoutFormDialog(dialog) {
    if (!dialog?.open) return;
    if (dialog.classList.contains("pins-dialog") || dialog.classList.contains("lightbox")) return;
    // Keep the admin sheet still until the user focuses the password field.
    if (
      dialog === adminDialog &&
      adminSheetFrozen &&
      document.activeElement !== adminPassword
    ) {
      return;
    }
    const vv = window.visualViewport;
    const vvTop = vv ? Math.round(vv.offsetTop || 0) : 0;
    const active = document.activeElement;
    const inputFocused =
      active === adminPassword ||
      active === renameInput ||
      active === dmCodeInput ||
      (dialog.contains(active) && (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA"));
    // Without a focused field, keep a stable full-sheet size (no keyboard shrink/jump).
    const vvH = inputFocused && vv
      ? Math.round(vv.height)
      : Math.round((vv?.height || window.innerHeight));
    const pad = 8;
    dialog.style.top = `${vvTop + pad}px`;
    dialog.style.left = "50%";
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.transform = "translateX(-50%)";
    dialog.style.maxHeight = `${Math.max(inputFocused ? 160 : 240, vvH - pad * 2)}px`;
    dialog.style.margin = "0";
  }

  function keepDialogAboveKeyboard(dialog, focusEl) {
    if (!dialog) return;
    // Only chase the keyboard when the field is actually focused.
    if (focusEl && document.activeElement !== focusEl) {
      layoutFormDialog(dialog);
      return;
    }
    const bump = () => {
      if (!dialog.open) return;
      syncViewportHeight();
      layoutFormDialog(dialog);
      if (dialog.classList.contains("dm-dialog")) layoutDmDialog();
      if (focusEl && document.activeElement === focusEl && typeof focusEl.scrollIntoView === "function") {
        try {
          focusEl.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          /* ignore */
        }
      }
    };
    bump();
    requestAnimationFrame(bump);
    setTimeout(bump, 120);
    setTimeout(bump, 320);
  }

  function layoutDmDialog() {
    if (!dmDialog?.open) return;
    layoutFormDialog(dmDialog);
    dmDialog.style.width = `min(400px, calc(100vw - 1.2rem))`;
    const vv = window.visualViewport;
    const vvTop = vv ? Math.round(vv.offsetTop || 0) : 0;
    const vvH = vv ? Math.round(vv.height) : Math.round(window.innerHeight);
    const body = dmDialog.querySelector(".dialog-body");
    if (body && dmCodeInput) {
      const inputRect = dmCodeInput.getBoundingClientRect();
      const dialogRect = dmDialog.getBoundingClientRect();
      const limit = vvTop + vvH - 12;
      if (inputRect.bottom > limit) {
        body.scrollTop += inputRect.bottom - limit + 10;
      } else if (inputRect.top < dialogRect.top + 8) {
        body.scrollTop = Math.max(0, body.scrollTop - (dialogRect.top + 8 - inputRect.top));
      }
    }
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

  function syncMeBtn() {
    if (!meBtn) return;
    const label = myName || "…";
    meBtn.textContent = label;
    meBtn.title = isAdmin ? `Вы: ${myName}` : myName ? `Вы: ${myName} · нажмите, чтобы сменить` : "Ваше имя";
    meBtn.classList.toggle("is-admin", isAdmin);
  }

  function setAdminUi(on, name) {
    isAdmin = on;
    document.body.classList.toggle("admin-on", on);
    if (name) {
      myName = name;
      saveName(name);
    }
    syncMeBtn();
    renderAll(lastState);
  }

  function applyAdminSession(res) {
    if (!res?.ok) return false;
    if (res.previousName) savePrevName(res.previousName);
    if (res.token) saveAdminToken(res.token);
    setAdminUi(true, res.name || "АДМИН");
    return true;
  }

  function logoutAdmin() {
    const token = loadAdminToken();
    const prev = loadPrevName();
    socket.emit("admin:logout", { token, name: prev }, (res) => {
      clearAdminToken();
      if (!res?.ok) {
        composerHint.textContent = res?.error || "Не удалось выйти из админки";
        return;
      }
      clearPrevName();
      setAdminUi(false, res.name);
      composerHint.textContent = `Снова обычный участник · ${res.name}`;
    });
  }

  function pinPreviewText(msg) {
    if (msg.text && msg.text.trim()) {
      return msg.text.replace(/\s+/g, " ").trim();
    }
    if (msg.imageUrl) return "📷 Фото";
    return "Сообщение";
  }

  function visiblePins() {
    return lastState.pinned || [];
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

  function clearPinFocus() {
    document.body.classList.remove("pins-list-open", "pins-focus-mode");
    feed.querySelectorAll(".msg.pin-focus, .msg.pin-flash").forEach((el) => {
      el.classList.remove("pin-focus", "pin-flash");
    });
  }

  function highlightPinPickerItem(index) {
    pinsList.querySelectorAll(".pins-picker-item").forEach((row, i) => {
      const on = i === index;
      row.classList.toggle("current", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
      if (on) {
        try {
          row.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          /* ignore */
        }
      }
    });
  }

  function scrollMsgAbovePinsPanel(el) {
    if (!el) return;
    const feedBox = feed.getBoundingClientRect();
    const dialogBox = pinsDialog.open
      ? pinsDialog.getBoundingClientRect()
      : { top: feedBox.bottom };
    const margin = 12;
    const viewTop = feedBox.top + margin;
    const viewBottom = Math.min(feedBox.bottom, dialogBox.top || feedBox.bottom) - margin;
    if (viewBottom <= viewTop + 40) return;

    const elBox = el.getBoundingClientRect();
    // Keep the pinned message at the top of the free band above the bottom sheet.
    const targetTop = viewTop + 2;
    let delta = elBox.top - targetTop;

    // If the message is shorter than the band and would sit awkwardly, still pin to top.
    // If taller than the band, still show its top edge.
    if (Math.abs(delta) < 2) {
      // Ensure bottom of free band isn't cutting mid-message awkwardly when short.
      return;
    }
    feedScroller.scrollTo(feed.scrollTop + delta, true);
  }

  function scrollToPinnedMessage(msg, { fromMenu = false } = {}) {
    const el = feed.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      composerHint.textContent = "Сообщение не в текущей ленте";
      return;
    }

    feed.querySelectorAll(".msg.pin-focus, .msg.pin-flash").forEach((node) => {
      node.classList.remove("pin-focus", "pin-flash");
    });
    el.classList.add("pin-focus");
    if (fromMenu || pinsDialog.open) {
      document.body.classList.add("pins-focus-mode");
      layoutPinsDialog();
      scrollMsgAbovePinsPanel(el);
      setTimeout(() => {
        layoutPinsDialog();
        scrollMsgAbovePinsPanel(el);
      }, 320);
    } else {
      el.classList.add("pin-flash");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.classList.remove("pin-flash"), 1200);
    }
  }

  function layoutPinsDialog() {
    if (!pinsDialog?.open) return;
    syncViewportHeight();
    const vv = window.visualViewport;
    const vvH = vv ? Math.round(vv.height) : Math.round(window.innerHeight);
    const vvBottom = vv ? Math.round((vv.offsetTop || 0) + vv.height) : vvH;
    const sidePad = 10;
    const bottomPad = 10;
    // Bottom sheet: leave most of the viewport free for the focused message above.
    const maxSheet = Math.round(vvH * 0.5);
    const bottomInset = Math.max(0, Math.round(window.innerHeight - vvBottom));

    pinsDialog.style.top = "auto";
    pinsDialog.style.left = "50%";
    pinsDialog.style.right = "auto";
    pinsDialog.style.bottom = `${bottomInset + bottomPad}px`;
    pinsDialog.style.transform = "translateX(-50%)";
    pinsDialog.style.width = `min(420px, calc(100vw - ${sidePad * 2}px))`;
    pinsDialog.style.maxWidth = `calc(100vw - ${sidePad * 2}px)`;
    pinsDialog.style.maxHeight = `${maxSheet}px`;
    pinsDialog.style.height = "auto";
  }

  function closePinsList() {
    clearUnpinArm();
    clearPinFocus();
    if (pinsDialog.open) pinsDialog.close();
  }

  function openPinsList() {
    const list = visiblePins();
    if (!list.length) return;
    clearUnpinArm();
    syncViewportHeight();
    pinsList.replaceChildren();
    list.forEach((msg, index) => {
      const row = document.createElement("div");
      row.className =
        "pins-picker-item" +
        (index === pinCycleIndex ? " current" : "") +
        (isAdmin ? " has-unpin" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === pinCycleIndex ? "true" : "false");

      const main = document.createElement("button");
      main.type = "button";
      main.className = "pins-picker-main";

      const name = document.createElement("span");
      name.className = "pins-picker-name";
      name.textContent = msg.name;

      const preview = document.createElement("span");
      preview.className = "pins-picker-preview";
      preview.textContent = pinPreviewText(msg);

      const meta = document.createElement("span");
      meta.className = "pins-picker-meta";
      meta.textContent = formatTime(msg.createdAt);

      main.append(name, preview, meta);
      main.addEventListener("click", () => {
        pinCycleIndex = index;
        updatePinBar();
        highlightPinPickerItem(index);
        scrollToPinnedMessage(msg, { fromMenu: true });
      });
      row.append(main);

      if (isAdmin) {
        const unpinBtn = document.createElement("button");
        unpinBtn.type = "button";
        unpinBtn.className = "pins-unpin";
        unpinBtn.textContent = "📌";
        unpinBtn.title = "Нажмите дважды, чтобы открепить";
        unpinBtn.setAttribute("aria-label", "Открепить");
        if (unpinArmedId === msg.id) unpinBtn.classList.add("armed");
        unpinBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (unpinArmedId === msg.id) {
            clearUnpinArm();
            socket.emit("admin:unpin", { id: msg.id }, (res) => {
              if (!res?.ok) {
                composerHint.textContent = res?.error || "Не открепилось";
                return;
              }
              lastState.pinned = (lastState.pinned || []).filter((m) => m.id !== msg.id);
              const inMessages = (lastState.messages || []).find((m) => m.id === msg.id);
              if (inMessages) inMessages.pinned = false;
              updatePinBar();
              if (visiblePins().length) openPinsList();
              else closePinsList();
              renderAll(lastState);
            });
            return;
          }
          clearUnpinArm();
          clearDeleteArm();
          unpinArmedId = msg.id;
          unpinBtn.classList.add("armed");
          unpinBtn.title = "Ещё раз — открепить";
          unpinArmedTimer = setTimeout(() => {
            if (unpinArmedId !== msg.id) return;
            clearUnpinArm();
          }, UNPIN_ARM_MS);
        });
        row.append(unpinBtn);
      }

      pinsList.append(row);
    });
    document.body.classList.add("pins-list-open");
    if (!pinsDialog.open) pinsDialog.showModal();
    requestAnimationFrame(() => {
      layoutPinsDialog();
      syncViewportHeight();
      layoutPinsDialog();
    });
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

  function closeMsgActionMenu() {
    document.querySelectorAll("body > .msg-action-menu").forEach((m) => m.remove());
    document.querySelectorAll(".msg.msg-menu-open").forEach((el) => {
      el.classList.remove("msg-menu-open");
    });
  }

  function closeAllReactMenus() {
    closeMsgActionMenu();
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

  function positionFixedMenu(menu, anchorEl, clientX, clientY) {
    const mw = menu.offsetWidth || 200;
    const mh = menu.offsetHeight || 120;
    const vv = window.visualViewport;
    const vvTop = vv ? vv.offsetTop || 0 : 0;
    const vvLeft = vv ? vv.offsetLeft || 0 : 0;
    const vvW = vv ? vv.width : window.innerWidth;
    const vvH = vv ? vv.height : window.innerHeight;
    const pad = 10;
    let left = typeof clientX === "number" ? clientX - mw / 2 : 0;
    let top = typeof clientY === "number" ? clientY - mh - 12 : 0;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      if (typeof clientX !== "number") left = rect.left + rect.width / 2 - mw / 2;
      if (typeof clientY !== "number") top = rect.top - mh - 10;
      // Prefer above message; if clipped, place below.
      if (top < vvTop + pad) top = rect.bottom + 10;
    }
    left = Math.max(vvLeft + pad, Math.min(left, vvLeft + vvW - mw - pad));
    top = Math.max(vvTop + pad, Math.min(top, vvTop + vvH - mh - pad));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function openMsgActionMenu(msg, msgEl, clientX, clientY) {
    closeAllReactMenus();
    if (!msg || !msgEl) return;
    msgEl.classList.add("msg-menu-open");

    const menu = document.createElement("div");
    menu.className = "msg-action-menu";
    menu.setAttribute("role", "menu");

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "msg-action-reply";
    replyBtn.setAttribute("role", "menuitem");
    replyBtn.textContent = "Ответить";
    replyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMsgActionMenu();
      setReplyTarget(msg);
    });

    const reacts = document.createElement("div");
    reacts.className = "msg-action-reacts";
    reacts.setAttribute("role", "group");
    reacts.setAttribute("aria-label", "Реакции");
    for (const { emoji, title } of REACTIONS) {
      const reactors = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
      const mine = reactors.includes(myName);
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "msg-action-react" + (mine ? " mine" : "");
      opt.title = title;
      opt.setAttribute("aria-label", title);
      opt.textContent = emoji;
      opt.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyReaction(msg.id, emoji);
      });
      reacts.append(opt);
    }

    menu.append(replyBtn, reacts);
    document.body.appendChild(menu);
    requestAnimationFrame(() => positionFixedMenu(menu, msgEl, clientX, clientY));
  }

  function bindMessageHold(el, msg) {
    let timer = null;
    let start = null;
    let opened = false;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    const DBL_MS = 300;
    const DBL_MOVE_PX = 18;

    const interactive = (target) =>
      Boolean(
        target.closest(
          "a, button, input, textarea, label, .msg-react-chip, .msg-admin-icon, .msg-quote, .msg-name"
        )
      );

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      start = null;
    };

    const openAt = (x, y) => {
      opened = true;
      lastTapAt = 0;
      clear();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* ignore */
      }
      openMsgActionMenu(msg, el, x, y);
    };

    const pulseLike = () => {
      el.classList.remove("msg-liked");
      void el.offsetWidth;
      el.classList.add("msg-liked");
      setTimeout(() => el.classList.remove("msg-liked"), 520);
      try {
        navigator.vibrate?.(8);
      } catch {
        /* ignore */
      }
    };

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (interactive(e.target)) return;
      opened = false;
      clear();
      start = { x: e.clientX, y: e.clientY };
      const x = e.clientX;
      const y = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        openAt(x, y);
      }, MSG_HOLD_MS);
    });

    el.addEventListener("pointermove", (e) => {
      if (!start || !timer) return;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx > MSG_HOLD_MOVE_PX || dy > MSG_HOLD_MOVE_PX) clear();
    });

    el.addEventListener("pointerup", (e) => {
      const wasTiming = Boolean(timer);
      const tapStart = start;
      clear();
      if (opened || !wasTiming || !tapStart) return;
      if (interactive(e.target)) return;
      const now = Date.now();
      const dx = Math.abs(e.clientX - lastTapX);
      const dy = Math.abs(e.clientY - lastTapY);
      if (now - lastTapAt < DBL_MS && dx < DBL_MOVE_PX && dy < DBL_MOVE_PX) {
        lastTapAt = 0;
        e.preventDefault();
        el.dataset.suppressPhoto = "1";
        setTimeout(() => {
          delete el.dataset.suppressPhoto;
        }, 400);
        pulseLike();
        ensureLike(msg.id);
        return;
      }
      lastTapAt = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    });
    el.addEventListener("pointercancel", clear);
    el.addEventListener("lostpointercapture", clear);

    el.addEventListener("contextmenu", (e) => {
      if (interactive(e.target)) return;
      e.preventDefault();
      openAt(e.clientX, e.clientY);
    });

    el.addEventListener(
      "click",
      (e) => {
        if (!opened) return;
        e.preventDefault();
        e.stopPropagation();
        opened = false;
      },
      true
    );
  }

  function removeMessageById(id) {
    if (!id) return;
    closeAllReactMenus();
    knownIds.delete(id);
    lastState.messages = (lastState.messages || []).filter((m) => m.id !== id);
    lastState.pinned = (lastState.pinned || []).filter((m) => m.id !== id);
    document.querySelectorAll("body > .msg-react-menu, body > .msg-action-menu").forEach((m) => m.remove());
    if (deleteArmedId === id) clearDeleteArm();

    const el = feed.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const finishChrome = () => {
      updatePinBar();
      updateJumpBottom();
    };

    if (!el) {
      finishChrome();
      return;
    }

    if (el.classList.contains("msg-leaving")) return;

    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const finish = () => {
      if (el.isConnected) el.remove();
      finishChrome();
    };

    if (reduceMotion) {
      finish();
      return;
    }

    const gap = parseFloat(getComputedStyle(feed).rowGap || getComputedStyle(feed).gap) || 0;
    const height = el.getBoundingClientRect().height;
    el.classList.add("msg-leaving");
    el.style.height = `${Math.max(0, height)}px`;
    el.style.overflow = "hidden";
    el.style.flexShrink = "0";
    el.setAttribute("aria-hidden", "true");

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", onEnd);
      finish();
    };
    const onEnd = (e) => {
      if (e.target !== el) return;
      if (e.propertyName && e.propertyName !== "height" && e.propertyName !== "margin-bottom") return;
      settle();
    };
    el.addEventListener("transitionend", onEnd);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.height = "0px";
        // Cancel the flex gap that would otherwise leave a hole until remove().
        el.style.marginBottom = `-${gap}px`;
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px) scale(0.985)";
      });
    });

    setTimeout(settle, 420);
  }

  function applyReaction(msgId, emoji) {
    closeAllReactMenus();
    socket.emit("chat:react", { id: msgId, emoji }, (res) => {
      if (!res?.ok) composerHint.textContent = res?.error || "Ошибка реакции";
    });
  }

  function ensureLike(msgId) {
    const msg =
      (lastState.messages || []).find((m) => m.id === msgId) ||
      (lastState.pinned || []).find((m) => m.id === msgId);
    const reactors = Array.isArray(msg?.reactions?.[LIKE_EMOJI]) ? msg.reactions[LIKE_EMOJI] : [];
    if (reactors.includes(myName)) return;
    applyReaction(msgId, LIKE_EMOJI);
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
    nameBtn.title = "Пригласить вдвоём";
    nameBtn.addEventListener("click", () => {
      const match = lastPeople.find((p) => p.name === msg.name && p.name !== myName);
      if (match) invitePerson(match);
      else {
        openOnlineList();
        composerHint.textContent = `${msg.name} сейчас не онлайн`;
      }
    });
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
      img.addEventListener("click", (e) => {
        if (el.dataset.suppressPhoto) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
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
          clearDeleteArm();
          socket.emit("admin:delete", { id: msg.id }, (res) => {
            if (!res?.ok) {
              composerHint.textContent = res?.error || "Ошибка";
              return;
            }
            removeMessageById(msg.id);
          });
          return;
        }
        // Only one ✕ can be armed; clear others first.
        clearDeleteArm();
        deleteArmedId = msg.id;
        delBtn.classList.add("armed");
        delBtn.title = "Ещё раз — удалить";
        deleteArmedTimer = setTimeout(() => {
          if (deleteArmedId !== msg.id) return;
          clearDeleteArm();
        }, DELETE_ARM_MS);
      });
      actions.append(delBtn);
    }

    if (actions.childElementCount) el.append(actions);
    bindMessageHold(el, msg);
    return el;
  }

  function renderAll(state) {
    closeAllReactMenus();
    document.querySelectorAll("body > .msg-react-menu, body > .msg-action-menu").forEach((m) => m.remove());
    lastState = state || lastState;
    const { messages = [] } = lastState;

    updatePinBar();

    const stick = pinToLatestOnce || isNearBottom(80);
    pinToLatestOnce = false;

    feed.replaceChildren();
    knownIds.clear();
    for (const msg of messages) {
      knownIds.add(msg.id);
      feed.append(renderMessage(msg));
    }

    if (stick) {
      schedulePinToLatest();
    } else {
      updateJumpBottom();
    }
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
    const nearBottom = isNearBottom(120);
    const el = renderMessage(msg);
    el.classList.add("msg-enter");
    feed.append(el);
    el.addEventListener(
      "animationend",
      () => {
        el.classList.remove("msg-enter");
      },
      { once: true }
    );
    const stick = nearBottom || msg.name === myName;
    if (stick) {
      scrollFeedToBottom(true);
      const img = el.querySelector(".msg-photo");
      if (img && !img.complete) {
        img.addEventListener("load", () => scrollFeedToBottom(true), { once: true });
      }
    } else {
      updateJumpBottom();
    }
  }

  function enterChat(name, { admin = false } = {}) {
    myName = name;
    saveName(name);
    gate.hidden = true;
    app.hidden = false;
    if (admin) setAdminUi(true, name);
    else if (isAdmin) setAdminUi(false);
    else syncMeBtn();
    pinToLatestOnce = true;
    syncViewportHeight();
    // Don't steal focus immediately — keyboard resize fights the first pin-to-bottom.
    schedulePinToLatest();
    setTimeout(() => {
      messageInput?.focus({ preventScroll: true });
      schedulePinToLatest();
    }, 120);
    const savedDm = loadDmCode();
    if (savedDm && !dmCode) {
      socket.emit("dm:join", { code: savedDm }, (res) => {
        if (res?.ok) enterDmMode(res);
        else {
          saveDmCode("");
          if (/не найден|проверьте код/i.test(res?.error || "")) forgetDmRoom(savedDm);
        }
      });
    }
  }

  function join(nameOverride) {
    showGateError("");
    const name = (nameOverride ?? nameInput.value).trim();
    const adminToken = loadAdminToken();
    const previousName = loadPrevName();
    socket.emit(
      "chat:join",
      {
        name,
        adminToken: adminToken || undefined,
        previousName: previousName || undefined,
      },
      (res) => {
        if (!res?.ok) {
          showGateError(res?.error || "Не удалось войти");
          return;
        }
        if (res.admin) {
          if (res.previousName) savePrevName(res.previousName);
          enterChat(res.name, { admin: true });
        } else {
          if (adminToken) clearAdminToken();
          enterChat(res.name, { admin: false });
        }
      }
    );
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
    if (isAdmin) {
      composerHint.textContent = "В админке имя всегда АДМИН";
      return;
    }
    if (!renameDialog || !renameInput) return;
    renameInput.value = myName || "";
    renameDialog.showModal();
    layoutFormDialog(renameDialog);
    // Focus after layout so iOS keyboard doesn't shove a centered dialog around.
    requestAnimationFrame(() => {
      layoutFormDialog(renameDialog);
      renameInput.focus();
      renameInput.select();
      keepDialogAboveKeyboard(renameDialog, renameInput);
    });
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
      syncMeBtn();
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

  presence?.addEventListener("click", () => {
    if (!myName) return;
    openOnlineList();
  });
  onlineCloseBtn?.addEventListener("click", closeOnlineList);
  onlineDialog?.addEventListener("click", (e) => {
    if (e.target === onlineDialog) closeOnlineList();
  });
  onlineDialog?.addEventListener("close", () => {
    onlineDialog.style.top = "";
    onlineDialog.style.bottom = "";
    onlineDialog.style.height = "";
    onlineDialog.style.maxHeight = "";
    onlineDialog.style.width = "";
    onlineDialog.style.maxWidth = "";
    onlineDialog.style.transform = "";
  });
  inviteAccept?.addEventListener("click", acceptInvite);
  inviteDecline?.addEventListener("click", declineInvite);

  pinsCloseBtn.addEventListener("click", closePinsList);
  pinsDialog.addEventListener("click", (e) => {
    if (e.target === pinsDialog) closePinsList();
  });
  pinsDialog.addEventListener("close", () => {
    clearUnpinArm();
    clearPinFocus();
    pinsDialog.style.top = "";
    pinsDialog.style.bottom = "";
    pinsDialog.style.height = "";
    pinsDialog.style.maxHeight = "";
    pinsDialog.style.width = "";
    pinsDialog.style.maxWidth = "";
    pinsDialog.style.transform = "";
  });

  const onPinsViewport = () => {
    if (pinsDialog.open) layoutPinsDialog();
    if (onlineDialog?.open) layoutBottomSheet(onlineDialog);
    if (dmDialog?.open) layoutDmDialog();
    if (renameDialog?.open) layoutFormDialog(renameDialog);
    if (adminDialog?.open) layoutFormDialog(adminDialog);
  };
  window.addEventListener("resize", onPinsViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onPinsViewport);
    window.visualViewport.addEventListener("scroll", onPinsViewport);
  }

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

  renameRandomBtn?.addEventListener("click", () => {
    fetchRandomName(renameInput).catch(() => {
      const fallback = ["Барс", "Лис", "Сокол", "Туман", "Искра", "Парус", "Неон"];
      renameInput.value = fallback[Math.floor(Math.random() * fallback.length)];
    });
  });
  renameCancelBtn?.addEventListener("click", () => renameDialog?.close());
  renameApplyBtn?.addEventListener("click", applyRename);
  renameInput?.addEventListener("focus", () => keepDialogAboveKeyboard(renameDialog, renameInput));
  renameDialog?.addEventListener("close", () => {
    renameDialog.style.top = "";
    renameDialog.style.bottom = "";
    renameDialog.style.maxHeight = "";
    renameDialog.style.transform = "";
    renameDialog.style.margin = "";
  });
  adminDialog?.addEventListener("close", () => {
    adminSheetFrozen = false;
    adminDialog.style.top = "";
    adminDialog.style.bottom = "";
    adminDialog.style.maxHeight = "";
    adminDialog.style.transform = "";
    adminDialog.style.margin = "";
  });
  lightbox?.addEventListener("close", () => {
    if (lightboxImg) lightboxImg.removeAttribute("src");
    syncViewportHeight();
  });
  renameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyRename();
    }
  });

  function openAdminDialog() {
    meTapCount = 0;
    if (meTapTimer) {
      clearTimeout(meTapTimer);
      meTapTimer = null;
    }
    if (meRenameTimer) {
      clearTimeout(meRenameTimer);
      meRenameTimer = null;
    }
    if (adminError) adminError.hidden = true;
    if (adminPassword) {
      adminPassword.value = "";
      try {
        adminPassword.blur();
      } catch {
        /* ignore */
      }
    }
    // Blur whatever stole focus (e.g. the nick button) so the keyboard stays down.
    try {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    } catch {
      /* ignore */
    }
    adminDialog.showModal();
    adminSheetFrozen = false;
    layoutFormDialog(adminDialog);
    requestAnimationFrame(() => {
      layoutFormDialog(adminDialog);
      adminSheetFrozen = true;
    });
  }

  function submitAdminLogin() {
    if (adminError) adminError.hidden = true;
    const password = (adminPassword?.value || "").trim();
    if (!password) {
      if (adminError) {
        adminError.hidden = false;
        adminError.textContent = "Введите пароль";
      }
      return;
    }
    if (myName && myName !== "АДМИН") savePrevName(myName);
    socket.emit("admin:login", { password }, (res) => {
      if (!res?.ok) {
        if (adminError) {
          adminError.hidden = false;
          adminError.textContent = res?.error || "Ошибка";
        }
        return;
      }
      applyAdminSession(res);
      adminDialog.close();
      composerHint.textContent = "Режим админа · ник АДМИН";
    });
  }

  let meTapCount = 0;
  let meTapTimer = null;
  let meRenameTimer = null;
  const ME_TAP_NEED = 10;
  const ME_TAP_WINDOW_MS = 2000;
  const ME_RENAME_DELAY_MS = 320;

  themeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleTheme();
  });

  meBtn?.addEventListener("click", () => {
    // Ignore stray taps while the admin sheet is already open.
    if (adminDialog?.open) return;

    meTapCount += 1;
    if (meTapTimer) clearTimeout(meTapTimer);
    if (meRenameTimer) clearTimeout(meRenameTimer);

    if (meTapCount >= ME_TAP_NEED) {
      meTapCount = 0;
      if (isAdmin) logoutAdmin();
      else openAdminDialog();
      return;
    }

    meTapTimer = setTimeout(() => {
      meTapCount = 0;
    }, ME_TAP_WINDOW_MS);

    // Single (or short) tap → rename; multi-tap streak for admin cancels this.
    if (!isAdmin) {
      meRenameTimer = setTimeout(() => {
        if (meTapCount === 1) {
          meTapCount = 0;
          openRenameDialog();
        }
      }, ME_RENAME_DELAY_MS);
    }
  });

  adminPassword?.addEventListener("focus", () => {
    adminSheetFrozen = false;
    // Keyboard only after the user taps the password field.
    keepDialogAboveKeyboard(adminDialog, adminPassword);
  });
  adminPassword?.addEventListener("blur", () => {
    if (adminDialog?.open) {
      requestAnimationFrame(() => {
        layoutFormDialog(adminDialog);
        adminSheetFrozen = true;
      });
    }
  });
  adminCancelBtn?.addEventListener("click", () => adminDialog?.close());
  adminSubmit?.addEventListener("click", (e) => {
    e.preventDefault();
    submitAdminLogin();
  });
  adminPassword?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAdminLogin();
    }
  });

  function joinDmFromInput() {
    joinDmByCode(dmCodeInput?.value || "");
  }

  function syncDmBtn() {
    if (!dmBtn) return;
    if (dmCode) {
      dmBtn.textContent = "Вдвоём";
      dmBtn.title = "Выйти в общий чат";
      dmBtn.classList.add("active");
    } else {
      dmBtn.textContent = "Вдвоём";
      dmBtn.title = "Чат вдвоём по коду";
      dmBtn.classList.remove("active");
    }
  }

  dmBtn?.addEventListener("click", () => {
    if (dmCode) {
      leaveDmMode();
      syncDmBtn();
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
      rememberDmRoom(res.code);
      enterDmMode(res);
      if (dmCodeInput) dmCodeInput.value = res.code;
      dmDialog?.close();
      composerHint.textContent = `Код ${res.code} — передайте второму человеку`;
    });
  });
  dmJoinBtn?.addEventListener("click", joinDmFromInput);
  dmCodeInput?.addEventListener("input", () => {
    const digits = (dmCodeInput.value || "").replace(/\D/g, "").slice(0, 6);
    if (dmCodeInput.value !== digits) dmCodeInput.value = digits;
  });
  dmCodeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      joinDmFromInput();
    }
  });
  dmDialog?.addEventListener("close", () => {
    dmDialog.style.top = "";
    dmDialog.style.bottom = "";
    dmDialog.style.height = "";
    dmDialog.style.maxHeight = "";
    dmDialog.style.width = "";
    dmDialog.style.transform = "";
  });
  dmCodeInput?.addEventListener("focus", () => keepDialogAboveKeyboard(dmDialog, dmCodeInput));
  dmCopyBtn?.addEventListener("click", async () => {
    if (!dmCode) return;
    try {
      await navigator.clipboard.writeText(dmCode);
      composerHint.textContent = `Код ${dmCode} скопирован`;
    } catch {
      composerHint.textContent = `Код: ${dmCode}`;
    }
  });

  socket.on("chat:state", (state) => {
    if (dmCode) return;
    // State often arrives while the gate is up; scrolling a hidden feed is lost
    // when #app becomes visible, so remember to land on the newest messages.
    if (app.hidden) pinToLatestOnce = true;
    renderAll(state);
    if (pinsDialog?.open) {
      if (visiblePins().length) openPinsList();
      else closePinsList();
    }
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

  socket.on("chat:presence", ({ count, people, names } = {}) => {
    lastPresenceCount = Number(count) || 0;
    if (Array.isArray(people) && people.length) {
      lastPeople = people
        .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
        .map((p) => ({ id: p.id, name: p.name }));
    } else if (Array.isArray(names)) {
      // Fallback if an older server build is still running.
      lastPeople = names.filter(Boolean).map((name, i) => ({ id: `n-${i}-${name}`, name }));
    } else {
      lastPeople = [];
    }
    updatePresenceChrome();
    if (onlineDialog?.open) renderOnlineList();
  });

  socket.on("dm:invite", (payload = {}) => {
    if (!payload.code || !myName) return;
    if (dmCode && dmCode === payload.code) return;
    showInviteBanner({
      code: payload.code,
      from: payload.from || "Кто-то",
      fromId: payload.fromId || "",
    });
  });

  socket.on("dm:invite-declined", ({ name } = {}) => {
    composerHint.textContent = `${name || "Участник"} отклонил приглашение`;
  });

  socket.on("connect", () => {
    if (myName) {
      const adminToken = loadAdminToken();
      const previousName = loadPrevName();
      socket.emit(
        "chat:join",
        {
          name: myName === "АДМИН" ? previousName || myName : myName,
          adminToken: adminToken || undefined,
          previousName: previousName || undefined,
        },
        (res) => {
          if (!res?.ok) return;
          myName = res.name;
          saveName(myName);
          if (res.admin) {
            if (res.previousName) savePrevName(res.previousName);
            setAdminUi(true, res.name);
          } else {
            if (adminToken) clearAdminToken();
            if (isAdmin) setAdminUi(false, res.name);
            else syncMeBtn();
          }
          if (dmCode) {
            socket.emit("dm:join", { code: dmCode }, (dmRes) => {
              if (dmRes?.ok) {
                enterDmMode(dmRes);
              } else {
                dmCode = null;
                document.body.classList.remove("dm-on");
                if (dmBar) dmBar.hidden = true;
                syncDmBtn();
              }
            });
          } else {
            syncDmBtn();
          }
        }
      );
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".msg-action-menu") || e.target.closest(".msg-react-menu")) return;
    closeAllReactMenus();
  });
  window.addEventListener("resize", closeAllReactMenus);
  feed.addEventListener("scroll", closeAllReactMenus, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllReactMenus();
  });

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
