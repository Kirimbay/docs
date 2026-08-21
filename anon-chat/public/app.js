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
  const appToast = $("#app-toast");
  const appToastText = $("#app-toast-text");
  const bulkBar = $("#bulk-bar");
  const bulkBarCount = $("#bulk-bar-count");
  const bulkCancelBtn = $("#bulk-cancel-btn");
  const bulkDeleteBtn = $("#bulk-delete-btn");
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
  const dmBtn = $("#dm-btn");
  const dmBar = $("#dm-bar");
  const dmBarCode = $("#dm-bar-code");
  const dmBarPresence = $("#dm-bar-presence");
  const dmCopyBtn = $("#dm-copy-btn");
  const dmDialog = $("#dm-dialog");
  const dmCreateBtn = $("#dm-create-btn");
  const dmLeavePublicBtn = $("#dm-leave-public-btn");
  const dmLead = $("#dm-lead");
  const dmJoinBtn = $("#dm-join-btn");
  const dmCodeInput = $("#dm-code-input");
  const dmDialogError = $("#dm-dialog-error");
  const dmDialogClose = $("#dm-dialog-close");
  const dmRoomsWrap = $("#dm-rooms-wrap");
  const dmRoomsList = $("#dm-rooms-list");
  const onlineDialog = $("#online-dialog");
  const onlineList = $("#online-list");
  const onlineCloseBtn = $("#online-close-btn");
  const invitesBtn = $("#invites-btn");
  const invitesDialog = $("#invites-dialog");
  const invitesList = $("#invites-list");
  const invitesCloseBtn = $("#invites-close-btn");
  const adminDialog = $("#admin-dialog");
  const adminPassword = $("#admin-password");
  const adminError = $("#admin-error");
  const adminSubmit = $("#admin-submit");
  const adminCancelBtn = $("#admin-cancel-btn");
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightbox-img");
  const lightboxClose = $("#lightbox-close");
  const notifyBtn = $("#notify-btn");
  const notifyMenu = $("#notify-menu");
  const notifyPublicInput = $("#notify-public");
  const notifyDmInput = $("#notify-dm");
  const notifyOffBtn = $("#notify-off-btn");

  const socket = io({ autoConnect: true });
  const NAME_KEY = "sarafan_name";
  const NAME_KEY_LEGACY = "komnata_name";
  const DM_CODE_KEY = "sarafan_dm_code";
  const DM_ROOMS_KEY = "sarafan_dm_rooms";
  const MAX_DM_ROOMS = 24;
  const ADMIN_TOKEN_KEY = "sarafan_admin_token";
  const PREV_NAME_KEY = "sarafan_prev_name";
  const NOTIFY_KEY = "sarafan_notify";
  const NOTIFY_PUBLIC_KEY = "sarafan_notify_public";
  const NOTIFY_DM_KEY = "sarafan_notify_dm";
  const ADMIN_ROOM_READS_KEY = "sarafan_admin_room_reads";
  const MAX_ADMIN_ROOM_READS = 200;
  const LIKE_EMOJI = "❤️";
  const REACTIONS = [
    { emoji: "😊", title: "смайл" },
    { emoji: LIKE_EMOJI, title: "любовь" },
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
  let lastState = { messages: [], pinned: [] };
  /** @type {{ id: string, name: string }[]} */
  let lastPeople = [];
  let lastPresenceCount = 0;
  /** @type {{ code: string, from: string, fromId: string, at: number }[]} */
  let pendingInvites = [];
  let publicStateBackup = null;
  let dmCode = null;
  /** @type {{ code: string, peer?: string, names?: string[], messageCount?: number, unread?: number, lastReadId?: string, foreign?: boolean, lastActiveAt?: string }[]} */
  let adminRoomCatalog = [];
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
  let forgetArmedCode = null;
  let forgetArmedTimer = null;
  const FORGET_ARM_MS = 1000;
  /** @type {Set<string>} */
  let bulkSelectedIds = new Set();
  let bulkSelectOn = false;
  let bulkDeleting = false;

  function prefersTouchAdminDelete() {
    try {
      if (typeof matchMedia !== "function") return Boolean(navigator.maxTouchPoints > 0);
      // iPhone / iPad / phones: finger primary, no hover.
      return (
        matchMedia("(pointer: coarse)").matches ||
        (navigator.maxTouchPoints > 0 && matchMedia("(hover: none)").matches)
      );
    } catch {
      return false;
    }
  }

  function requestAdminDelete(id) {
    if (!id) return;
    socket.emit("admin:delete", { id }, (res) => {
      if (!res?.ok) {
        notify(res?.error || "Ошибка");
        return;
      }
      removeMessageById(id);
    });
  }

  function resetMsgSwipe(wrap, animate) {
    if (!wrap) return;
    const bubble = wrap.querySelector(".msg");
    wrap.classList.remove("is-swiping", "is-open");
    if (bubble) {
      bubble.style.transition = animate
        ? "transform 200ms cubic-bezier(0.33, 1, 0.68, 1)"
        : "none";
      bubble.style.transform = "";
    }
  }

  function closeOpenMsgSwipes(except) {
    feed.querySelectorAll(".msg-swipe.is-open, .msg-swipe.is-swiping").forEach((wrap) => {
      if (except && wrap === except) return;
      resetMsgSwipe(wrap, true);
    });
  }

  function bindAdminSwipeDelete(wrap, el, msg) {
    const rail = wrap.querySelector(".msg-swipe-rail");
    const MAX = 92;
    const COMMIT = 56;
    let start = null;
    let axis = null;
    let dx = 0;

    const setOffset = (x, withTransition) => {
      const open = x < -6;
      wrap.classList.toggle("is-swiping", !withTransition && x !== 0);
      wrap.classList.toggle("is-open", open);
      el.style.transition = withTransition
        ? "transform 200ms cubic-bezier(0.33, 1, 0.68, 1)"
        : "none";
      el.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      if (rail) {
        rail.style.opacity = String(Math.min(1, Math.abs(x) / 36));
      }
    };

    wrap.addEventListener(
      "pointerdown",
      (e) => {
        if (!isAdmin || bulkSelectOn) return;
        if (e.pointerType === "mouse") return;
        if (
          e.target.closest(
            "a, button, input, textarea, label, .msg-react-chip, .msg-admin-icon, .msg-quote, .msg-name"
          )
        ) {
          return;
        }
        closeOpenMsgSwipes(wrap);
        start = { x: e.clientX, y: e.clientY };
        axis = null;
        dx = 0;
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      },
      { passive: true }
    );

    wrap.addEventListener(
      "pointermove",
      (e) => {
        if (!start) return;
        const rawDx = e.clientX - start.x;
        const rawDy = e.clientY - start.y;
        if (!axis) {
          if (Math.abs(rawDx) < 10 && Math.abs(rawDy) < 10) return;
          axis = Math.abs(rawDx) > Math.abs(rawDy) * 1.2 ? "h" : "v";
          if (axis === "v") {
            start = null;
            axis = null;
            return;
          }
          // Cancel tap / long-press / copy on the bubble.
          el.dataset.swipeIgnore = "1";
          el.dispatchEvent(new CustomEvent("msg-swipe-cancel"));
        }
        if (axis !== "h") return;
        if (e.cancelable) e.preventDefault();
        // Only swipe left (reveal delete on the right).
        dx = Math.min(0, Math.max(-MAX, rawDx));
        setOffset(dx, false);
      },
      { passive: false }
    );

    const endSwipe = () => {
      if (axis === "h") {
        if (dx <= -COMMIT) {
          setOffset(-MAX, true);
          el.dataset.swipeIgnore = "1";
          requestAdminDelete(msg.id);
        } else {
          resetMsgSwipe(wrap, true);
        }
      }
      start = null;
      axis = null;
      dx = 0;
    };

    wrap.addEventListener("pointerup", endSwipe);
    wrap.addEventListener("pointercancel", () => {
      if (axis === "h") resetMsgSwipe(wrap, true);
      start = null;
      axis = null;
      dx = 0;
    });
  }

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

  function clearForgetArm() {
    if (forgetArmedTimer) {
      clearTimeout(forgetArmedTimer);
      forgetArmedTimer = null;
    }
    forgetArmedCode = null;
    document.querySelectorAll(".dm-room-forget").forEach((btn) => {
      const wasArmed = btn.classList.contains("armed");
      btn.classList.remove("armed");
      btn.title = "Нажмите дважды, чтобы убрать";
      btn.textContent = "×";
      // Drop sticky focus/hover paint after the arm window ends (esp. iOS).
      if (wasArmed || document.activeElement === btn) {
        try {
          btn.blur();
        } catch {
          /* ignore */
        }
      }
    });
  }

  function syncBulkBar() {
    if (!bulkBar) return;
    const n = bulkSelectedIds.size;
    if (!bulkSelectOn) {
      bulkBar.hidden = true;
      document.body.classList.remove("bulk-select-on");
      return;
    }
    bulkBar.hidden = false;
    document.body.classList.add("bulk-select-on");
    if (bulkBarCount) {
      bulkBarCount.textContent = n === 1 ? "Выбрано 1" : `Выбрано ${n}`;
    }
    if (bulkDeleteBtn) {
      bulkDeleteBtn.disabled = n === 0 || bulkDeleting;
      bulkDeleteBtn.textContent = n > 0 ? `Удалить · ${n}` : "Удалить";
    }
  }

  function clearBulkSelectionClasses() {
    feed.querySelectorAll(".msg.msg-bulk-selected").forEach((node) => {
      node.classList.remove("msg-bulk-selected");
    });
  }

  function exitBulkSelectMode() {
    bulkSelectOn = false;
    bulkSelectedIds = new Set();
    bulkDeleting = false;
    clearBulkSelectionClasses();
    syncBulkBar();
  }

  function enterBulkSelectMode(msg) {
    if (!isAdmin) return;
    closeMsgActionMenu();
    closeAllReactMenus();
    clearDeleteArm();
    bulkSelectOn = true;
    bulkSelectedIds = new Set();
    if (msg?.id) {
      bulkSelectedIds.add(msg.id);
      const el = feed.querySelector(`[data-id="${CSS.escape(msg.id)}"]`);
      el?.classList.add("msg-bulk-selected");
    }
    syncBulkBar();
    try {
      navigator.vibrate?.(14);
    } catch {
      /* ignore */
    }
  }

  function toggleBulkSelectMessage(msg, el) {
    if (!bulkSelectOn || !msg?.id || !el) return;
    if (bulkSelectedIds.has(msg.id)) {
      bulkSelectedIds.delete(msg.id);
      el.classList.remove("msg-bulk-selected");
    } else {
      bulkSelectedIds.add(msg.id);
      el.classList.add("msg-bulk-selected");
    }
    syncBulkBar();
    if (bulkSelectedIds.size === 0) exitBulkSelectMode();
  }

  function captureFeedAnchor(excludeIds) {
    const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
    const feedRect = feed.getBoundingClientRect();
    const msgs = feed.querySelectorAll(".msg");
    for (const el of msgs) {
      const id = el.dataset.id;
      if (!id || excluded.has(id)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > feedRect.top + 4 && r.top < feedRect.bottom - 4) {
        return { id, offset: r.top - feedRect.top };
      }
    }
    return {
      scrollTop: feed.scrollTop,
      maxScroll: Math.max(0, feed.scrollHeight - feed.clientHeight),
    };
  }

  function restoreFeedAnchor(anchor) {
    if (!anchor) return;
    if (anchor.id) {
      const el = feed.querySelector(`.msg[data-id="${CSS.escape(anchor.id)}"]`);
      if (el) {
        const feedRect = feed.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        feed.scrollTop += r.top - feedRect.top - anchor.offset;
        return;
      }
    }
    const max = Math.max(0, feed.scrollHeight - feed.clientHeight);
    if (typeof anchor.scrollTop === "number") {
      // Prefer staying near the previous viewport; clamp if content shrank.
      feed.scrollTop = Math.min(anchor.scrollTop, max);
    } else {
      feed.scrollTop = max;
    }
  }

  function deleteBulkSelected() {
    if (!isAdmin || bulkDeleting) return;
    const ids = [...bulkSelectedIds];
    if (!ids.length) return;
    bulkDeleting = true;
    syncBulkBar();

    const exclude = new Set(ids);
    const anchor = captureFeedAnchor(exclude);

    // Instant batch remove — no per-bubble collapse (that stacked and scrolled the feed away).
    for (const id of ids) {
      removeMessageById(id, { animate: false, adjustScroll: false });
    }
    restoreFeedAnchor(anchor);
    exitBulkSelectMode();
    updatePinBar();
    updateJumpBottom();

    // Fire server deletes in parallel; DOM is already cleaned up.
    let fail = null;
    let pending = ids.length;
    for (const id of ids) {
      socket.emit("admin:delete", { id }, (res) => {
        if (!res?.ok && res?.error) fail = res.error;
        pending -= 1;
        if (pending <= 0 && fail) notify(fail);
      });
    }
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
    /** @type {{ code: string, lastAt: number, peer: string, messageCount: number, lastReadId: string, names: string[], unread: number }[]} */
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
              peer: typeof item?.peer === "string" ? item.peer.trim().slice(0, 48) : "",
              messageCount: Math.max(0, Number(item?.messageCount) || 0),
              lastReadId: typeof item?.lastReadId === "string" ? item.lastReadId.trim().slice(0, 80) : "",
              names: Array.isArray(item?.names)
                ? item.names
                    .filter((n) => typeof n === "string" && n.trim())
                    .map((n) => n.trim().slice(0, 24))
                    .slice(0, 100)
                : [],
              unread: Math.max(0, Number(item?.unread) || 0),
            }))
            .filter((item) => item.code.length === 6);
        }
      }
    } catch {
      rooms = [];
    }
    const legacy = loadDmCode();
    if (legacy.length === 6 && !rooms.some((r) => r.code === legacy)) {
      rooms.unshift({
        code: legacy,
        lastAt: Date.now(),
        peer: "",
        messageCount: 0,
        lastReadId: "",
        names: [],
        unread: 0,
      });
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
            .map((r) => ({
              code: r.code,
              lastAt: Number(r.lastAt) || 0,
              peer: typeof r.peer === "string" ? r.peer.trim().slice(0, 48) : "",
              messageCount: Math.max(0, Number(r.messageCount) || 0),
              lastReadId: typeof r.lastReadId === "string" ? r.lastReadId.trim().slice(0, 80) : "",
              names: Array.isArray(r.names)
                ? r.names
                    .filter((n) => typeof n === "string" && n.trim())
                    .map((n) => n.trim().slice(0, 24))
                    .slice(0, 100)
                : [],
              unread: Math.max(0, Number(r.unread) || 0),
            }))
            .slice(0, MAX_DM_ROOMS)
        )
      );
    } catch {
      /* ignore */
    }
  }

  function messagesLabel(count) {
    const n = Math.max(0, Number(count) || 0);
    const abs = n % 100;
    const d = abs % 10;
    if (abs > 10 && abs < 20) return `${n} сообщений`;
    if (d === 1) return `${n} сообщение`;
    if (d >= 2 && d <= 4) return `${n} сообщения`;
    return `${n} сообщений`;
  }

  function newMessagesLabel(count) {
    const n = Math.max(0, Number(count) || 0);
    if (n <= 0) return "нет новых";
    const abs = n % 100;
    const d = abs % 10;
    if (abs > 10 && abs < 20) return `${n} новых`;
    if (d === 1) return `${n} новое`;
    if (d >= 2 && d <= 4) return `${n} новых`;
    return `${n} новых`;
  }

  function lastMessageIdFromList(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return "";
    return String(list[list.length - 1]?.id || "");
  }

  function namesLabel(names, { collapsed = true } = {}) {
    const list = Array.isArray(names)
      ? names.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
      : [];
    if (!list.length) return "Пока никого";
    if (!collapsed || list.length <= 3) return list.join(", ");
    return `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
  }

  function peerFromDmPayload(res = {}) {
    if (Array.isArray(res.names) && res.names.length) {
      return namesLabel(
        res.names.filter((n) => n && n !== myName),
        { collapsed: true }
      );
    }
    const names = Array.isArray(res.names) ? res.names.filter((n) => n && n !== myName) : [];
    if (names.length === 1) return names[0];
    if (names.length > 1) return `${names[0]} +${names.length - 1}`;
    if (res.invited && res.invited !== myName) return res.invited;
    const seen = [];
    const msgs = Array.isArray(res.messages) ? res.messages : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const name = msgs[i]?.name;
      if (!name || name === myName) continue;
      if (!seen.includes(name)) seen.push(name);
      if (seen.length >= 3) break;
    }
    if (seen.length === 1) return seen[0];
    if (seen.length > 1) return `${seen[0]} +${seen.length - 1}`;
    return "";
  }

  /** @type {Set<string>} */
  const expandedDmRoomCodes = new Set();

  function rememberDmRoom(
    code,
    { active = true, peer, messageCount, lastReadId, names, unread } = {}
  ) {
    const c = normalizeDmCodeLocal(code);
    if (c.length !== 6) return;
    const prev = loadDmRooms().find((r) => r.code === c);
    const rooms = loadDmRooms().filter((r) => r.code !== c);
    const nextPeer =
      typeof peer === "string" && peer.trim()
        ? peer.trim().slice(0, 48)
        : prev?.peer || "";
    const nextCount =
      typeof messageCount === "number" && Number.isFinite(messageCount)
        ? Math.max(0, messageCount)
        : prev?.messageCount || 0;
    const nextReadId =
      typeof lastReadId === "string"
        ? lastReadId.trim().slice(0, 80)
        : prev?.lastReadId || "";
    const nextNames = Array.isArray(names)
      ? names
          .filter((n) => typeof n === "string" && n.trim())
          .map((n) => n.trim().slice(0, 24))
          .slice(0, 100)
      : prev?.names || [];
    const nextUnread =
      typeof unread === "number" && Number.isFinite(unread)
        ? Math.max(0, unread)
        : active
          ? 0
          : prev?.unread || 0;
    rooms.unshift({
      code: c,
      lastAt: Date.now(),
      peer: nextPeer,
      messageCount: nextCount,
      lastReadId: nextReadId,
      names: nextNames,
      unread: nextUnread,
    });
    saveDmRooms(rooms);
    if (active) saveDmCode(c);
  }

  function markDmRoomRead(code, messages, extra = {}) {
    const list = Array.isArray(messages) ? messages : [];
    rememberDmRoom(code, {
      ...extra,
      messageCount: list.length,
      lastReadId: lastMessageIdFromList(list),
      unread: 0,
      active: Boolean(dmCode && dmCode === normalizeDmCodeLocal(code)),
    });
  }

  function loadAdminRoomReads() {
    try {
      const raw = localStorage.getItem(ADMIN_ROOM_READS_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return {};
      /** @type {Record<string, string>} */
      const out = {};
      for (const [code, id] of Object.entries(data)) {
        const c = normalizeDmCodeLocal(code);
        if (!c || typeof id !== "string") continue;
        out[c] = id.trim().slice(0, 80);
      }
      return out;
    } catch {
      return {};
    }
  }

  function saveAdminRoomReads(map) {
    try {
      const entries = Object.entries(map || {})
        .filter(([code, id]) => normalizeDmCodeLocal(code) && typeof id === "string" && id)
        .slice(0, MAX_ADMIN_ROOM_READS);
      localStorage.setItem(ADMIN_ROOM_READS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* ignore */
    }
  }

  function markAdminRoomRead(code, messages) {
    const c = normalizeDmCodeLocal(code);
    if (!c) return;
    const lastId = lastMessageIdFromList(messages);
    if (!lastId) return;
    const map = loadAdminRoomReads();
    map[c] = lastId;
    saveAdminRoomReads(map);
  }

  function roomsForDmList() {
    const saved = loadDmRooms().map((room) => ({ ...room, foreign: false }));
    if (!isAdmin) return saved;
    const savedCodes = new Set(saved.map((r) => r.code));
    const extras = adminRoomCatalog
      .filter((room) => room?.code && !savedCodes.has(room.code))
      .map((room) => ({
        code: room.code,
        peer: room.peer || "",
        names: Array.isArray(room.names) ? room.names : [],
        messageCount: Math.max(0, Number(room.messageCount) || 0),
        unread: Math.max(0, Number(room.unread) || 0),
        lastReadId: room.lastReadId || "",
        lastActiveAt: room.lastActiveAt || "",
        foreign: true,
      }));
    return [...saved, ...extras];
  }

  function refreshAdminRoomCatalog({ render = true } = {}) {
    if (!isAdmin || !socket.connected) {
      adminRoomCatalog = [];
      if (render && dmDialog?.open) renderDmRoomsList({ skipRefresh: true });
      return;
    }
    const reads = loadAdminRoomReads();
    const saved = loadDmRooms();
    const sinceRooms = [
      ...saved.map((r) => ({ code: r.code, sinceId: r.lastReadId || "" })),
      ...Object.entries(reads).map(([code, sinceId]) => ({ code, sinceId })),
    ];
    socket.emit("dm:admin-rooms", { rooms: sinceRooms }, (res) => {
      if (!res?.ok || !Array.isArray(res.rooms)) return;
      adminRoomCatalog = res.rooms
        .filter((r) => r && r.exists !== false && r.code)
        .map((r) => ({
          code: normalizeDmCodeLocal(r.code),
          peer: typeof r.peer === "string" ? r.peer : "",
          names: Array.isArray(r.names) ? r.names : [],
          messageCount: Math.max(0, Number(r.messageCount) || 0),
          unread: Math.max(0, Number(r.unread) || 0),
          lastReadId: reads[normalizeDmCodeLocal(r.code)] || "",
          lastActiveAt: typeof r.lastActiveAt === "string" ? r.lastActiveAt : "",
          foreign: true,
        }))
        .filter((r) => r.code);
      // Keep saved-room meta fresh from the same payload.
      const byCode = new Map(res.rooms.map((r) => [normalizeDmCodeLocal(r.code), r]));
      const nextSaved = loadDmRooms()
        .map((room) => {
          const meta = byCode.get(room.code);
          if (!meta) return room;
          if (meta.exists === false) return null;
          const isCurrent = dmCode === room.code;
          const names = Array.isArray(meta.names) ? meta.names : room.names || [];
          return {
            ...room,
            peer: meta.peer || room.peer || "",
            messageCount: Math.max(0, Number(meta.messageCount) || 0),
            names,
            unread: isCurrent ? 0 : Math.max(0, Number(meta.unread) || 0),
            lastReadId: isCurrent
              ? meta.lastMessageId || room.lastReadId || ""
              : room.lastReadId || "",
          };
        })
        .filter(Boolean);
      saveDmRooms(nextSaved);
      if (render && dmDialog?.open) renderDmRoomsList({ skipRefresh: true });
    });
  }

  function refreshDmRoomsMeta() {
    if (isAdmin) {
      refreshAdminRoomCatalog({ render: true });
      return;
    }
    const rooms = loadDmRooms();
    if (!rooms.length || !socket.connected) return;
    socket.emit(
      "dm:rooms-meta",
      {
        rooms: rooms.map((r) => ({
          code: r.code,
          sinceId: r.lastReadId || "",
        })),
      },
      (res) => {
        if (!res?.ok || !Array.isArray(res.rooms)) return;
        const byCode = new Map(res.rooms.map((r) => [r.code, r]));
        const next = loadDmRooms()
          .map((room) => {
            const meta = byCode.get(room.code);
            if (!meta) return room;
            if (!meta.exists) return null;
            const isCurrent = dmCode === room.code;
            const names = Array.isArray(meta.names) ? meta.names : room.names || [];
            return {
              ...room,
              peer: meta.peer || room.peer || "",
              messageCount: Math.max(0, Number(meta.messageCount) || 0),
              names,
              unread: isCurrent ? 0 : Math.max(0, Number(meta.unread) || 0),
              lastReadId: isCurrent
                ? meta.lastMessageId || room.lastReadId || ""
                : room.lastReadId || "",
            };
          })
          .filter(Boolean);
        saveDmRooms(next);
        if (dmDialog?.open) renderDmRoomsList({ skipRefresh: true });
      }
    );
  }

  function forgetDmRoom(code) {
    const c = normalizeDmCodeLocal(code);
    if (!c) return;
    saveDmRooms(loadDmRooms().filter((r) => r.code !== c));
    if (loadDmCode() === c) saveDmCode("");
  }

  function joinDmByCode(code, { fromList = false, watchOnly = false } = {}) {
    showDmDialogError("");
    const c = normalizeDmCodeLocal(code);
    if (dmCodeInput) dmCodeInput.value = c;
    if (c.length !== 6) {
      showDmDialogError("Нужен код из 6 цифр");
      return;
    }
    const ghost = Boolean(isAdmin && (watchOnly || roomsForDmList().some((r) => r.code === c && r.foreign)));
    socket.emit("dm:join", { code: c }, (res) => {
      if (!res?.ok) {
        const err = res?.error || "Не удалось войти";
        showDmDialogError(err);
        if (/не найден|проверьте код/i.test(err)) {
          forgetDmRoom(c);
          renderDmRoomsList();
        }
        return;
      }
      enterDmMode(res, { watchOnly: ghost || Boolean(res.ghost) });
      void closeDmDialogSoft();
    });
  }

  function renderDmRoomsList({ skipRefresh = false } = {}) {
    if (!dmRoomsList || !dmRoomsWrap) return;
    const rooms = roomsForDmList();
    const heading = dmRoomsWrap.querySelector(".dm-rooms-heading");
    if (heading) heading.textContent = isAdmin ? "Комнаты" : "Ваши комнаты";
    dmRoomsList.replaceChildren();
    if (!rooms.length) {
      dmRoomsWrap.hidden = true;
      return;
    }
    dmRoomsWrap.hidden = false;
    for (const room of rooms) {
      const row = document.createElement("div");
      row.className = "dm-room-row" + (room.foreign ? " is-foreign" : "");
      row.setAttribute("role", "listitem");
      const expanded = expandedDmRoomCodes.has(room.code);
      if (expanded) row.classList.add("is-expanded");

      const main = document.createElement("div");
      main.className = "dm-room-main";

      const enterBtn = document.createElement("button");
      enterBtn.type = "button";
      enterBtn.className = "dm-room-enter";
      const unread = dmCode === room.code ? 0 : Math.max(0, Number(room.unread) || 0);
      enterBtn.title = room.foreign
        ? unread
          ? `Смотреть · ${newMessagesLabel(unread)}`
          : `Смотреть комнату ${room.code}`
        : unread
          ? `Войти · ${newMessagesLabel(unread)}`
          : `Войти в комнату ${room.code}`;

      const codeEl = document.createElement("strong");
      codeEl.className = "dm-room-code";
      codeEl.textContent = room.code;

      const unreadEl = document.createElement("span");
      unreadEl.className = "dm-room-unread" + (unread > 0 ? " has-new" : "");
      unreadEl.textContent =
        dmCode === room.code ? (room.foreign || isAdmin ? "смотр" : "вы здесь") : newMessagesLabel(unread);

      enterBtn.append(codeEl, unreadEl);
      enterBtn.addEventListener("click", () =>
        joinDmByCode(room.code, { fromList: true, watchOnly: Boolean(room.foreign) })
      );

      const namesBtn = document.createElement("button");
      namesBtn.type = "button";
      namesBtn.className = "dm-room-names";
      const fullNames = Array.isArray(room.names) ? room.names : [];
      namesBtn.textContent = namesLabel(fullNames, { collapsed: !expanded });
      namesBtn.title = fullNames.length
        ? expanded
          ? "Свернуть список"
          : "Показать всех"
        : "Пока никого";
      namesBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      namesBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!fullNames.length) return;
        if (expandedDmRoomCodes.has(room.code)) expandedDmRoomCodes.delete(room.code);
        else expandedDmRoomCodes.add(room.code);
        renderDmRoomsList({ skipRefresh: true });
      });

      main.append(enterBtn, namesBtn);
      row.append(main);

      if (!room.foreign) {
        const forgetBtn = document.createElement("button");
        forgetBtn.type = "button";
        forgetBtn.className = "dm-room-forget ghost compact";
        forgetBtn.dataset.code = room.code;
        forgetBtn.setAttribute("aria-label", `Убрать ${room.code} из списка`);
        forgetBtn.title = "Нажмите дважды, чтобы убрать";
        forgetBtn.textContent = "×";
        if (forgetArmedCode === room.code) {
          forgetBtn.classList.add("armed");
          forgetBtn.title = "Ещё раз — убрать";
        }
        forgetBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (forgetArmedCode === room.code) {
            clearForgetArm();
            forgetDmRoom(room.code);
            expandedDmRoomCodes.delete(room.code);
            renderDmRoomsList({ skipRefresh: true });
            return;
          }
          clearForgetArm();
          forgetArmedCode = room.code;
          forgetBtn.classList.add("armed");
          forgetBtn.title = "Ещё раз — убрать";
          forgetArmedTimer = setTimeout(() => {
            if (forgetArmedCode !== room.code) return;
            clearForgetArm();
          }, FORGET_ARM_MS);
        });
        row.append(forgetBtn);
      }

      dmRoomsList.append(row);
    }
    if (!skipRefresh) refreshDmRoomsMeta();
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

  function updateDmPresence({ count, names, participants, maxMembers } = {}) {
    if (!dmBarPresence) return;
    const n = Number(count) || 0;
    const max = Number(maxMembers) > 0 ? Number(maxMembers) : 100;
    dmBarPresence.textContent = `${n}/${max}`;
    if (!dmCode) return;
    const roster = Array.isArray(participants) && participants.length ? participants : names;
    const peer = peerFromDmPayload({ names: roster, messages: lastState.messages || [] });
    if (peer || (Array.isArray(roster) && roster.length)) {
      rememberDmRoom(dmCode, {
        peer,
        names: Array.isArray(roster) ? roster : undefined,
        messageCount: Array.isArray(lastState.messages) ? lastState.messages.length : undefined,
        lastReadId: lastMessageIdFromList(lastState.messages),
        unread: 0,
      });
    }
  }

  function enterDmMode(res, { watchOnly = false } = {}) {
    if (!res?.ok || !res.code) return;
    if (!dmCode) publicStateBackup = { messages: [...(lastState.messages || [])], pinned: [...(lastState.pinned || [])] };
    dmCode = res.code;
    removePendingInvite(res.code);
    const ghost = Boolean(watchOnly || res.ghost);
    if (ghost) {
      markAdminRoomRead(res.code, res.messages || []);
      if (loadDmRooms().some((r) => r.code === res.code)) {
        markDmRoomRead(res.code, res.messages || [], {
          peer: peerFromDmPayload(res),
          names: Array.isArray(res.participants)
            ? res.participants
            : Array.isArray(res.names)
              ? res.names
              : undefined,
        });
      }
    } else {
      rememberDmRoom(res.code, {
        peer: peerFromDmPayload(res),
        names: Array.isArray(res.participants)
          ? res.participants
          : Array.isArray(res.names)
            ? res.names
            : undefined,
        messageCount: Array.isArray(res.messages) ? res.messages.length : 0,
        lastReadId: lastMessageIdFromList(res.messages),
        unread: 0,
      });
    }
    document.body.classList.add("dm-on");
    document.body.classList.toggle("dm-ghost", Boolean(isAdmin));
    if (dmBar) dmBar.hidden = false;
    if (dmBarCode) dmBarCode.textContent = res.code;
    clearReply();
    renderAll({ messages: res.messages || [], pinned: [] }, { briefPin: true });
    updateDmPresence(res);
    if (messageInput) {
      messageInput.placeholder = isAdmin ? "Написать как админ…" : "Написать в комнату…";
    }
    notify(
      res.invited
        ? `Пригласили ${res.invited} · код ${res.code}`
        : isAdmin
          ? `Комната ${res.code} · вы невидимы в счётчике`
          : `Код ${res.code} · до 100 человек`
    );
    syncDmBtn();
  }

  function leaveDmMode() {
    const prev = dmCode;
    const peer = peerFromDmPayload({
      names: [],
      messages: lastState.messages || [],
    });
    const snapshotMessages = lastState.messages || [];
    const wasSaved = prev ? loadDmRooms().some((r) => r.code === prev) : false;
    dmCode = null;
    // Keep room in the saved list; only clear "active session" code.
    saveDmCode("");
    document.body.classList.remove("dm-on", "dm-ghost");
    if (dmBar) dmBar.hidden = true;
    if (messageInput) messageInput.placeholder = "Написать сообщение…";
    clearReply();
    // Restore public feed under the dialog before it closes — avoids a blank
    // flash and a second hard rebuild when chat:state arrives with the same data.
    if (publicStateBackup) {
      renderAll(publicStateBackup, { briefPin: true });
      publicStateBackup = null;
    } else {
      schedulePinToLatest({ brief: true });
    }
    socket.emit("dm:leave", {}, () => {
      /* chat:state follows from server */
    });
    syncDmBtn();
    if (prev) {
      if (wasSaved) {
        markDmRoomRead(prev, snapshotMessages, {
          active: false,
          peer,
        });
      } else if (isAdmin) {
        markAdminRoomRead(prev, snapshotMessages);
      }
      saveDmCode("");
      notify(`Снова общий чат · ${prev} в меню «Комната»`);
    }
  }

  function syncDmDialogChrome() {
    const inDm = Boolean(dmCode);
    if (dmLeavePublicBtn) dmLeavePublicBtn.hidden = !inDm;
    if (dmLead) {
      dmLead.textContent = inDm
        ? `Сейчас ${dmCode} · можно сменить или в общий`
        : "До 100 человек · история до 5000";
    }
  }

  function openDmDialog() {
    if (!dmDialog) return;
    showDmDialogError("");
    syncDmDialogChrome();
    if (isAdmin) {
      renderDmRoomsList({ skipRefresh: true });
      refreshAdminRoomCatalog({ render: true });
    } else {
      renderDmRoomsList();
    }
    if (dmCodeInput) dmCodeInput.value = "";
    dmDialog.showModal();
    layoutDmDialog();
    keepDialogAboveKeyboard(dmDialog, dmCodeInput);
    const rooms = roomsForDmList();
    if (!rooms.length && !dmCode) dmCodeInput?.focus();
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
    if (!person?.id || person.id === socket.id) return;
    closeOnlineList();
    socket.emit("dm:invite", { toId: person.id }, (res) => {
      if (!res?.ok) {
        notify(res?.error || "Не удалось пригласить");
        return;
      }
      if (person.name) res.invited = person.name;
      enterDmMode(res);
      notify(
        res.created === false
          ? `${person.name} приглашён в комнату ${res.code}`
          : `Приглашение ${person.name} · код ${res.code}`
      );
    });
  }

  function renderOnlineList() {
    if (!onlineList) return;
    const people = lastPeople.filter((p) => p.name);
    const prevFocus = onlineList.querySelector(":focus")?.dataset?.id || "";
    onlineList.replaceChildren();
    if (!people.length) {
      const empty = document.createElement("p");
      empty.className = "user-list-empty";
      empty.textContent = "Пока никого онлайн";
      onlineList.append(empty);
      return;
    }
    people
      .slice()
      .sort((a, b) => {
        const aSelf = a.id === socket.id ? 0 : 1;
        const bSelf = b.id === socket.id ? 0 : 1;
        if (aSelf !== bSelf) return aSelf - bSelf;
        return a.name.localeCompare(b.name, "ru");
      })
      .forEach((person) => {
        const isSelf = person.id === socket.id;
        const row = document.createElement(isSelf ? "div" : "button");
        if (!isSelf) row.type = "button";
        row.className = "online-row" + (isSelf ? " is-self" : "");
        row.setAttribute("role", "option");
        row.dataset.id = person.id;
        const name = document.createElement("span");
        name.className = "online-row-name";
        name.textContent = person.name;
        const action = document.createElement("span");
        action.className = "online-row-action";
        action.textContent = isSelf ? "это вы" : "пригласить";
        row.append(name, action);
        if (!isSelf) row.addEventListener("click", () => invitePerson(person));
        onlineList.append(row);
        if (person.id === prevFocus && !isSelf) row.focus({ preventScroll: true });
      });
  }

  function openOnlineList() {
    if (!onlineDialog || !myName) return;
    syncViewportHeight();
    renderOnlineList();
    if (!onlineDialog.open) onlineDialog.showModal();
    layoutBottomSheet(onlineDialog);
  }

  function syncInvitesBtn() {
    if (!invitesBtn) return;
    const n = pendingInvites.length;
    if (!n) {
      invitesBtn.hidden = true;
      invitesBtn.classList.remove("has-invites");
      invitesBtn.removeAttribute("aria-label");
      if (invitesDialog?.open) invitesDialog.close();
      return;
    }
    invitesBtn.hidden = false;
    invitesBtn.classList.add("has-invites");
    const label = n === 1 ? "Вас зовут в комнату" : `Вас зовут · ${n}`;
    invitesBtn.title = label;
    invitesBtn.setAttribute("aria-label", label);
  }

  function removePendingInvite(code) {
    const key = String(code || "");
    pendingInvites = pendingInvites.filter((inv) => inv.code !== key);
    syncInvitesBtn();
    if (invitesDialog?.open) renderInvitesList();
  }

  function queueInvite(invite) {
    const code = String(invite?.code || "").trim();
    if (!code) return;
    if (dmCode && dmCode === code) return;
    pendingInvites = pendingInvites.filter((inv) => inv.code !== code);
    pendingInvites.unshift({
      code,
      from: invite.from || "Кто-то",
      fromId: invite.fromId || "",
      at: Date.now(),
    });
    syncInvitesBtn();
    if (invitesDialog?.open) renderInvitesList();
  }

  function renderInvitesList() {
    if (!invitesList) return;
    invitesList.replaceChildren();
    if (!pendingInvites.length) {
      const empty = document.createElement("p");
      empty.className = "user-list-empty";
      empty.textContent = "Пока нет приглашений";
      invitesList.append(empty);
      return;
    }
    pendingInvites.forEach((invite) => {
      const row = document.createElement("div");
      row.className = "invite-row";
      row.setAttribute("role", "option");
      row.dataset.code = invite.code;

      const meta = document.createElement("div");
      meta.className = "invite-row-meta";
      const name = document.createElement("span");
      name.className = "invite-row-name";
      name.textContent = invite.from || "Кто-то";
      const sub = document.createElement("span");
      sub.className = "invite-row-sub";
      sub.textContent = "зовёт в комнату · без пина";
      meta.append(name, sub);

      const actions = document.createElement("div");
      actions.className = "invite-row-actions";
      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "invite-chip invite-chip-no";
      declineBtn.textContent = "Нет";
      declineBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        declineInvite(invite);
      });
      const enterBtn = document.createElement("button");
      enterBtn.type = "button";
      enterBtn.className = "invite-chip invite-chip-yes";
      enterBtn.textContent = "Войти";
      enterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        acceptInvite(invite);
      });
      actions.append(declineBtn, enterBtn);
      row.append(meta, actions);
      row.addEventListener("click", () => acceptInvite(invite));
      invitesList.append(row);
    });
  }

  function openInvitesDialog() {
    if (!invitesDialog || !pendingInvites.length) return;
    syncViewportHeight();
    renderInvitesList();
    if (!invitesDialog.open) invitesDialog.showModal();
    layoutBottomSheet(invitesDialog);
  }

  function closeInvitesDialog() {
    if (invitesDialog?.open) invitesDialog.close();
  }

  function acceptInvite(invite) {
    if (!invite?.code) return;
    const from = invite.from || "участником";
    closeInvitesDialog();
    socket.emit("dm:join", { code: invite.code }, (res) => {
      if (!res?.ok) {
        notify(res?.error || "Не удалось войти")
        syncInvitesBtn();
        return;
      }
      enterDmMode(res);
      notify(`Вошли в комнату с ${from}`)
    });
  }

  function declineInvite(invite) {
    if (!invite) return;
    removePendingInvite(invite.code);
    if (invite.fromId) {
      socket.emit("dm:invite-decline", { fromId: invite.fromId });
    }
    if (!pendingInvites.length) closeInvitesDialog();
  }

  const RANDOM_NAME_FALLBACK = ["Барс", "Лис", "Сокол", "Туман", "Искра", "Парус", "Неон", "Кедр", "Роса", "Маяк"];
  let randomNamePool = null;
  let randomNameDeck = [];

  function nameEquals(a, b) {
    return (
      String(a || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("ru-RU") ===
      String(b || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("ru-RU")
    );
  }

  function shuffleNames(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function refillRandomNameDeck(avoid) {
    const pool = randomNamePool?.length ? randomNamePool : RANDOM_NAME_FALLBACK;
    let next = shuffleNames(pool);
    if (avoid) {
      const filtered = next.filter((n) => !nameEquals(n, avoid));
      if (filtered.length) next = filtered;
    }
    randomNameDeck = next;
  }

  async function loadRandomNamePool() {
    if (randomNamePool?.length) return randomNamePool;
    const res = await fetch("/api/name-pool");
    const data = await res.json();
    const names = Array.isArray(data?.names)
      ? data.names.map((n) => String(n || "").trim()).filter(Boolean)
      : [];
    randomNamePool = names.length ? names : RANDOM_NAME_FALLBACK;
    return randomNamePool;
  }

  async function fetchRandomName(targetInput = nameInput) {
    const current = (targetInput?.value || "").trim();
    try {
      await loadRandomNamePool();
      if (!randomNameDeck.length) refillRandomNameDeck(current);

      let next = null;
      while (randomNameDeck.length) {
        const candidate = randomNameDeck.pop();
        if (!nameEquals(candidate, current)) {
          next = candidate;
          break;
        }
      }
      if (!next) {
        refillRandomNameDeck(current);
        next = randomNameDeck.pop() || current;
      }
      if (targetInput && next) targetInput.value = next;
      return next || "";
    } catch {
      if (!randomNamePool?.length) randomNamePool = RANDOM_NAME_FALLBACK;
      if (!randomNameDeck.length) refillRandomNameDeck(current);
      let next = randomNameDeck.pop();
      if (!next || nameEquals(next, current)) {
        refillRandomNameDeck(current);
        next = randomNameDeck.pop() || current;
      }
      if (targetInput && next) targetInput.value = next;
      return next || "";
    }
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

    // http(s)/www and bare domains like apps.apple.com/path or github.com/...
    const re =
      /(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;
    const TRAIL = ".,;:!?)]}\"'>»";
    let last = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      // Don't treat the domain part of an email as a link.
      if (start > 0 && text.charAt(start - 1) === "@") {
        continue;
      }
      if (start > last) {
        container.append(document.createTextNode(text.slice(last, start)));
      }

      let url = match[0];
      let trailing = "";
      while (url.length > 1 && TRAIL.includes(url.slice(-1))) {
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

      if (!linked) {
        container.append(document.createTextNode(match[0]));
        last = start + match[0].length;
      } else {
        if (trailing) container.append(document.createTextNode(trailing));
        last = start + url.length + trailing.length;
      }
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

  function schedulePinToLatest({ brief = false } = {}) {
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
    if (brief) {
      setTimeout(run, 80);
      return;
    }
    setTimeout(run, 60);
    setTimeout(run, 220);
    setTimeout(run, 480);
    // Photos / viewport chrome often grow the feed after the first jump.
    feed.querySelectorAll("img.msg-photo").forEach((img) => {
      if (img.complete) return;
      img.addEventListener("load", run, { once: true });
    });
  }

  function feedShowsMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const nodes = feed.querySelectorAll(".msg[data-id]");
    if (nodes.length !== list.length) return false;
    for (let i = 0; i < list.length; i += 1) {
      const msg = list[i];
      const node = nodes[i];
      if (!msg || node.dataset.id !== msg.id) return false;
      // Pin / unpin keeps the same ids — must still redraw badges and red frame.
      if (Boolean(msg.pinned) !== node.classList.contains("pinned-item")) return false;
    }
    return true;
  }

  async function closeDmDialogSoft() {
    if (!dmDialog?.open) return;
    dmDialog.classList.add("is-leaving");
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      dmDialog.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 180);
    });
    if (dmDialog.open) dmDialog.close();
    dmDialog.classList.remove("is-leaving");
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
    if (dialog.classList.contains("pins-dialog") || dialog.classList.contains("lightbox") || dialog.classList.contains("dm-dialog")) return;
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
    const safeTop =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--safe-top")
      ) || 0;
    // Clear of the status bar; avoid hugging the clock on iPhone.
    const pad = Math.max(12, Math.round(safeTop) + 8);
    dialog.style.top = `${vvTop + pad}px`;
    dialog.style.left = "50%";
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.transform = "translateX(-50%)";
    dialog.style.maxHeight = `${Math.max(inputFocused ? 160 : 240, vvH - pad - 8)}px`;
    dialog.style.margin = "0";
  }

  function keepDialogAboveKeyboard(dialog, focusEl) {
    if (!dialog) return;
    // Only chase the keyboard when the field is actually focused.
    if (focusEl && document.activeElement !== focusEl) {
      layoutFormDialog(dialog);
      return;
    }
    const sheetTop =
      dialog.classList.contains("sheet-top") ||
      dialog === adminDialog ||
      dialog === renameDialog;
    const bump = () => {
      if (!dialog.open) return;
      syncViewportHeight();
      layoutFormDialog(dialog);
      if (dialog.classList.contains("dm-dialog")) layoutDmDialog();
      // scrollIntoView on iPhone shifts visualViewport and makes sheet-top dialogs jump.
      if (
        !sheetTop &&
        focusEl &&
        document.activeElement === focusEl &&
        typeof focusEl.scrollIntoView === "function"
      ) {
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
    syncViewportHeight();
    const vv = window.visualViewport;
    const vvTop = vv ? Math.round(vv.offsetTop || 0) : 0;
    const vvH = vv ? Math.round(vv.height) : Math.round(window.innerHeight || 0);
    const height = Math.max(240, vvH || Math.round(window.innerHeight || 0));
    // Inline styles beat UA <dialog> centering and leftover animation transforms
    // (especially Chrome iOS, where translate(-50%) pushes a full-width sheet off-screen).
    dmDialog.style.setProperty("position", "fixed", "important");
    dmDialog.style.setProperty("inset", "auto", "important");
    dmDialog.style.setProperty("top", `${vvTop}px`, "important");
    dmDialog.style.setProperty("left", "0px", "important");
    dmDialog.style.setProperty("right", "0px", "important");
    dmDialog.style.setProperty("bottom", "auto", "important");
    dmDialog.style.setProperty("width", "100%", "important");
    dmDialog.style.setProperty("max-width", "none", "important");
    dmDialog.style.setProperty("min-width", "0", "important");
    dmDialog.style.setProperty("height", `${height}px`, "important");
    dmDialog.style.setProperty("max-height", `${height}px`, "important");
    dmDialog.style.setProperty("margin", "0", "important");
    dmDialog.style.setProperty("transform", "none", "important");
    dmDialog.style.setProperty("translate", "none", "important");
    dmDialog.style.setProperty("animation", "none", "important");
    dmDialog.style.setProperty("border-radius", "0", "important");
    const body = dmDialog.querySelector(".dialog-body");
    if (body && dmCodeInput && document.activeElement === dmCodeInput) {
      const inputRect = dmCodeInput.getBoundingClientRect();
      const limit = vvTop + height - 12;
      if (inputRect.bottom > limit) {
        body.scrollTop += inputRect.bottom - limit + 10;
      }
    }
  }

  function autoSize() {
    messageInput.style.height = "auto";
    const visible = window.visualViewport?.height || window.innerHeight;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const minH = narrow ? 32 : 33;
    const cap = Math.min(narrow ? 68 : 84, Math.round(visible * (narrow ? 0.13 : 0.16)));
    messageInput.style.height = `${Math.min(Math.max(messageInput.scrollHeight, minH), Math.max(minH, cap))}px`;
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
    if (!on) {
      adminRoomCatalog = [];
      document.body.classList.remove("dm-ghost");
    }
    if (name) {
      myName = name;
      saveName(name);
    }
    if (!on && bulkSelectOn) exitBulkSelectMode();
    syncMeBtn();
    renderAll(lastState);
    if (on && dmDialog?.open) refreshAdminRoomCatalog({ render: true });
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
        notify(res?.error || "Не удалось выйти из админки")
        return;
      }
      clearPrevName();
      setAdminUi(false, res.name);
      notify(`Снова обычный участник · ${res.name}`)
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
    document.documentElement.style.removeProperty("--pins-sheet-space");
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

  function syncPinsSheetSpace() {
    if (!pinsDialog?.open) {
      document.documentElement.style.removeProperty("--pins-sheet-space");
      return 0;
    }
    const feedBox = feed.getBoundingClientRect();
    const dialogBox = pinsDialog.getBoundingClientRect();
    // How much of the feed is covered by the sheet (+ gap so the pin isn't flush).
    const covered = Math.max(0, Math.round(feedBox.bottom - dialogBox.top + 28));
    const space = Math.max(200, covered);
    document.documentElement.style.setProperty("--pins-sheet-space", `${space}px`);
    feedScroller.refresh?.();
    return space;
  }

  function scrollMsgAbovePinsPanel(el, { smooth = true } = {}) {
    if (!el) return;
    syncPinsSheetSpace();
    const feedBox = feed.getBoundingClientRect();
    const dialogBox = pinsDialog.open
      ? pinsDialog.getBoundingClientRect()
      : { top: feedBox.bottom };
    const margin = 14;
    const viewTop = feedBox.top + margin;
    const viewBottom = Math.min(feedBox.bottom, dialogBox.top || feedBox.bottom) - margin;
    if (viewBottom <= viewTop + 48) return;

    const elBox = el.getBoundingClientRect();
    // Prefer the message sitting just under the pin bar / top of the free band.
    const targetTop = viewTop + 4;
    let delta = elBox.top - targetTop;

    // If the bubble is taller than the free band, keep its top visible.
    if (elBox.height > viewBottom - viewTop && elBox.bottom > viewBottom) {
      delta = elBox.top - targetTop;
    } else if (elBox.bottom > viewBottom) {
      // Bottom clipped by the sheet — lift until fully above (or as much as padding allows).
      delta = Math.max(delta, elBox.bottom - viewBottom);
    }

    if (Math.abs(delta) < 2) return;
    const next = feed.scrollTop + delta;
    if (smooth) feedScroller.scrollTo(next, true);
    else {
      feed.scrollTop = next;
      feedScroller.refresh?.();
    }
  }

  function scrollToPinnedMessage(msg, { fromMenu = false } = {}) {
    const el = feed.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      notify("Сообщение не в текущей ленте")
      return;
    }

    feed.querySelectorAll(".msg.pin-focus, .msg.pin-flash").forEach((node) => {
      node.classList.remove("pin-focus", "pin-flash");
    });
    el.classList.add("pin-focus");
    if (fromMenu || pinsDialog.open) {
      document.body.classList.add("pins-focus-mode");
      layoutPinsDialog();
      syncPinsSheetSpace();
      // Instant first jump after padding expands scroll range, then a settle pass.
      scrollMsgAbovePinsPanel(el, { smooth: false });
      requestAnimationFrame(() => {
        layoutPinsDialog();
        syncPinsSheetSpace();
        scrollMsgAbovePinsPanel(el, { smooth: true });
      });
      setTimeout(() => {
        layoutPinsDialog();
        syncPinsSheetSpace();
        scrollMsgAbovePinsPanel(el, { smooth: true });
      }, 280);
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
    const maxSheet = Math.round(vvH * 0.42);
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
    syncPinsSheetSpace();
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
        unpinBtn.textContent = "Открепить";
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
                notify(res?.error || "Не открепилось")
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
    const focusIdx = Math.min(Math.max(pinCycleIndex, 0), list.length - 1);
    pinCycleIndex = focusIdx;
    highlightPinPickerItem(focusIdx);
    requestAnimationFrame(() => {
      layoutPinsDialog();
      syncViewportHeight();
      layoutPinsDialog();
      scrollToPinnedMessage(list[focusIdx], { fromMenu: true });
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

    menu.append(replyBtn);

    if (msg.imageUrl) {
      const photoBtn = document.createElement("button");
      photoBtn.type = "button";
      photoBtn.className = "msg-action-reply";
      photoBtn.setAttribute("role", "menuitem");
      photoBtn.textContent = "Открыть фото";
      photoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMsgActionMenu();
        openLightbox(msg.imageUrl);
      });
      menu.append(photoBtn);
    }

    if (msg.text) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msg-action-reply";
      copyBtn.setAttribute("role", "menuitem");
      copyBtn.textContent = "Копировать";
      copyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMsgActionMenu();
        copyBubbleText(msg);
      });
      menu.append(copyBtn);
    }

    if (isAdmin && !dmCode) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "msg-action-reply";
      pinBtn.setAttribute("role", "menuitem");
      pinBtn.textContent = msg.pinned ? "Открепить" : "Закрепить";
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMsgActionMenu();
        const event = msg.pinned ? "admin:unpin" : "admin:pin";
        socket.emit(event, { id: msg.id }, (res) => {
          if (!res?.ok) {
            notify(res?.error || "Ошибка");
            return;
          }
          // chat:state follows; apply locally too so the badge appears even if
          // the broadcast is delayed or coalesced.
          const nextPinned = event === "admin:pin";
          const inMessages = (lastState.messages || []).find((m) => m.id === msg.id);
          if (inMessages) inMessages.pinned = nextPinned;
          if (nextPinned) {
            const pub = inMessages || msg;
            pub.pinned = true;
            lastState.pinned = [
              pub,
              ...(lastState.pinned || []).filter((m) => m.id !== msg.id),
            ].slice(0, 20);
          } else {
            lastState.pinned = (lastState.pinned || []).filter((m) => m.id !== msg.id);
          }
          renderAll(lastState, { force: true, briefPin: true });
        });
      });
      menu.append(pinBtn);
    }

    // Own messages: reply/copy only — no self-reactions.
    if (!isOwnMessage(msg)) {
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
      menu.append(reacts);
    }

    document.body.appendChild(menu);
    requestAnimationFrame(() => positionFixedMenu(menu, msgEl, clientX, clientY));
  }

  let appToastTimer = null;
  let lastNotice = "";

  function hideAppToast() {
    if (appToastTimer) {
      clearTimeout(appToastTimer);
      appToastTimer = null;
    }
    lastNotice = "";
    if (!appToast) return;
    appToast.classList.remove("show", "dim");
    const finish = () => {
      if (!appToast.classList.contains("show")) appToast.hidden = true;
    };
    appToast.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 280);
  }

  function notify(text, { dim = true, clearMs = 1800 } = {}) {
    const msg = String(text || "").trim();
    if (!msg || !appToast || !appToastText) return;
    lastNotice = msg;
    appToastText.textContent = msg;
    appToast.hidden = false;
    appToast.classList.toggle("dim", Boolean(dim));
    // Force reflow so the show transition always plays.
    void appToast.offsetWidth;
    appToast.classList.add("show");
    if (appToastTimer) clearTimeout(appToastTimer);
    appToastTimer = setTimeout(() => {
      if (lastNotice === msg) hideAppToast();
    }, clearMs);
  }

  async function copyBubbleText(msg) {
    const text = (msg?.text || "").trim();
    if (!text) {
      notify("В сообщении нет текста", { dim: true });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("Текст сообщения скопирован", { dim: true, clearMs: 1600 });
      try {
        navigator.vibrate?.(10);
      } catch {
        /* ignore */
      }
      return;
    } catch {
      /* fallback below */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      notify("Текст сообщения скопирован", { dim: true, clearMs: 1600 });
    } catch {
      notify("Не удалось скопировать", { dim: true });
    }
  }

  function bindMessageHold(el, msg) {
    // 1 tap → menu, 2 taps → copy, 3 taps (admin) → bulk select.
    const TAP_WAIT_MS = 320;
    const LONG_MS = 480;
    const MOVE_PX = 12;

    let longTimer = null;
    let singleTimer = null;
    let start = null;
    let longPressed = false;
    let tapCount = 0;
    let menuOpened = false;

    const interactive = (target) =>
      Boolean(
        target.closest(
          "a, button, input, textarea, label, .msg-react-chip, .msg-admin-icon, .msg-quote, .msg-name"
        )
      );

    const clearLong = () => {
      if (longTimer) {
        clearTimeout(longTimer);
        longTimer = null;
      }
    };

    const clearSingle = () => {
      if (singleTimer) {
        clearTimeout(singleTimer);
        singleTimer = null;
      }
    };

    const openAt = (x, y) => {
      if (bulkSelectOn) return;
      menuOpened = true;
      tapCount = 0;
      clearSingle();
      clearLong();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* ignore */
      }
      openMsgActionMenu(msg, el, x, y);
    };

    const copyFromDouble = () => {
      if (bulkSelectOn) return;
      clearSingle();
      clearLong();
      tapCount = 0;
      closeMsgActionMenu();
      void copyBubbleText(msg);
    };

    const startBulk = () => {
      clearSingle();
      clearLong();
      tapCount = 0;
      closeMsgActionMenu();
      if (!isAdmin) {
        void copyBubbleText(msg);
        return;
      }
      enterBulkSelectMode(msg);
    };

    el.addEventListener("msg-swipe-cancel", () => {
      clearLong();
      clearSingle();
      start = null;
      tapCount = 0;
      menuOpened = false;
      longPressed = false;
    });

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (interactive(e.target)) return;
      if (el.dataset.swipeIgnore) delete el.dataset.swipeIgnore;
      longPressed = false;
      menuOpened = false;
      start = { x: e.clientX, y: e.clientY };
      clearLong();
      if (bulkSelectOn) return;
      longTimer = setTimeout(() => {
        longTimer = null;
        longPressed = true;
        tapCount = 0;
        clearSingle();
        el.classList.add("msg-selecting");
        try {
          navigator.vibrate?.(8);
        } catch {
          /* ignore */
        }
      }, LONG_MS);
    });

    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx > MOVE_PX || dy > MOVE_PX) {
        clearLong();
        start = null;
      }
    });

    el.addEventListener("pointerup", (e) => {
      if (el.dataset.swipeIgnore) {
        delete el.dataset.swipeIgnore;
        clearLong();
        start = null;
        return;
      }
      const wasLong = longPressed;
      const hadStart = Boolean(start);
      const x = e.clientX;
      const y = e.clientY;
      clearLong();
      start = null;
      if (interactive(e.target)) return;
      if (wasLong) return;
      if (!hadStart) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      if (bulkSelectOn) {
        toggleBulkSelectMessage(msg, el);
        return;
      }

      tapCount += 1;
      if (tapCount === 1) {
        singleTimer = setTimeout(() => {
          singleTimer = null;
          tapCount = 0;
          openAt(x, y);
        }, TAP_WAIT_MS);
      } else if (tapCount === 2) {
        clearSingle();
        singleTimer = setTimeout(() => {
          singleTimer = null;
          tapCount = 0;
          copyFromDouble();
        }, TAP_WAIT_MS);
      } else {
        startBulk();
      }
    });

    el.addEventListener("pointercancel", () => {
      clearLong();
      start = null;
    });

    el.addEventListener("dblclick", (e) => {
      if (bulkSelectOn) {
        e.preventDefault();
        e.stopPropagation();
        toggleBulkSelectMessage(msg, el);
        return;
      }
      if (interactive(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      // Wait for a possible third click via pointerup path; if none, copy timer fires.
    });

    el.addEventListener("contextmenu", (e) => {
      if (bulkSelectOn) {
        e.preventDefault();
        return;
      }
      // Long-press selection: keep the native callout / selection handles.
      if (longPressed || el.classList.contains("msg-selecting")) return;
      // Quote / chips / links handle themselves — don't open the bubble menu.
      if (interactive(e.target)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      clearSingle();
      tapCount = 0;
      openAt(e.clientX, e.clientY);
    });

    el.addEventListener(
      "click",
      (e) => {
        if (interactive(e.target)) return;
        if (bulkSelectOn) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Swallow the delayed click after we already handled taps / opened menu.
        if (menuOpened || singleTimer || tapCount > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (menuOpened) menuOpened = false;
      },
      true
    );
  }

  function removeMessageById(id, opts = {}) {
    if (!id) return;
    const animate = opts.animate !== false;
    const adjustScroll = opts.adjustScroll !== false;

    closeAllReactMenus();
    knownIds.delete(id);
    lastState.messages = (lastState.messages || []).filter((m) => m.id !== id);
    lastState.pinned = (lastState.pinned || []).filter((m) => m.id !== id);
    if (bulkSelectedIds.has(id)) {
      bulkSelectedIds.delete(id);
      syncBulkBar();
      if (bulkSelectOn && bulkSelectedIds.size === 0 && !bulkDeleting) exitBulkSelectMode();
    }
    document.querySelectorAll("body > .msg-react-menu, body > .msg-action-menu").forEach((m) => m.remove());
    if (deleteArmedId === id) clearDeleteArm();

    const el = feed.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
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

    const gap = parseFloat(getComputedStyle(feed).rowGap || getComputedStyle(feed).gap) || 0;
    const height = el.getBoundingClientRect().height;
    const offsetTop = el.offsetTop;
    const startScroll = feed.scrollTop;
    // If the bubble sits above the viewport, shrink scroll with it so the
    // visible messages stay put while neighbors close the gap.
    const anchorAbove = adjustScroll && offsetTop + 1 < startScroll;
    const scrollDelta = height + gap;

    const row = el.closest(".msg-swipe");
    const finish = () => {
      const node = row && row.isConnected ? row : el;
      if (node.isConnected) node.remove();
      finishChrome();
    };

    if (!animate || reduceMotion || height < 1) {
      if (anchorAbove) {
        feed.scrollTop = Math.max(0, startScroll - scrollDelta);
      }
      finish();
      return;
    }

    el.style.transform = "";
    el.style.transition = "none";
    if (row) {
      row.classList.remove("is-swiping", "is-open");
      row.style.overflow = "hidden";
      row.style.height = `${height}px`;
      row.style.flexShrink = "0";
    }
    el.classList.add("msg-leaving");
    el.style.height = `${height}px`;
    el.style.overflow = "hidden";
    el.style.flexShrink = "0";
    el.setAttribute("aria-hidden", "true");

    // Short, soft collapse — no scale/slide; scroll tracks height so neighbors don't jerk.
    const DURATION = 160;
    const ease = (t) => t * t * (3 - 2 * t); // smoothstep
    const t0 = performance.now();
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (anchorAbove) {
        feed.scrollTop = Math.max(0, startScroll - scrollDelta);
      }
      finish();
    };

    const frame = (now) => {
      if (settled || !el.isConnected) {
        settle();
        return;
      }
      const t = Math.min(1, (now - t0) / DURATION);
      const e = ease(t);
      const h = height * (1 - e);
      el.style.height = `${h}px`;
      el.style.marginBottom = `${-gap * e}px`;
      el.style.opacity = String(1 - e);
      if (row) {
        row.style.height = `${h}px`;
        row.style.marginBottom = `${-gap * e}px`;
      }
      if (anchorAbove) {
        feed.scrollTop = Math.max(0, startScroll - scrollDelta * e);
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        settle();
      }
    };
    requestAnimationFrame(frame);
    setTimeout(settle, DURATION + 80);
  }

  function applyReaction(msgId, emoji) {
    closeAllReactMenus();
    const prev =
      (lastState.messages || []).find((m) => m.id === msgId) ||
      (lastState.pinned || []).find((m) => m.id === msgId);
    if (prev && isOwnMessage(prev)) {
      notify("На своё сообщение реакцию не ставят");
      return;
    }
    const hadMine = Boolean(
      myName && Array.isArray(prev?.reactions?.[emoji]) && prev.reactions[emoji].includes(myName)
    );
    socket.emit("chat:react", { id: msgId, emoji }, (res) => {
      if (!res?.ok) {
        notify(res?.error || "Ошибка реакции");
        return;
      }
      const added = typeof res.added === "boolean" ? res.added : !hadMine;
      // Celebrate only adding; removing should just vanish with no ghost bubble.
      if (!added) return;
      requestAnimationFrame(() => {
        setTimeout(() => popReactionBubble(msgId, emoji), 40);
        setTimeout(() => popReactionBubble(msgId, emoji), 160);
      });
    });
  }

  function popReactionBubble(msgId, emoji) {
    const msgEl = feed.querySelector(`[data-id="${CSS.escape(msgId)}"]`);
    if (!msgEl) return;
    const chip =
      [...msgEl.querySelectorAll(".msg-react-chip")].find((c) => (c.textContent || "").includes(emoji)) ||
      null;
    if (!chip) return;
    chip.classList.remove("react-pop");
    void chip.offsetWidth;
    chip.classList.add("react-pop");
    setTimeout(() => chip.classList.remove("react-pop"), 420);
  }

  function isOwnMessage(msg) {
    const name = typeof msg?.name === "string" ? msg.name.trim() : "";
    const me = typeof myName === "string" ? myName.trim() : "";
    return Boolean(name && me && name === me);
  }

  function renderMessage(msg) {
    const el = document.createElement("article");
    el.className = "msg";
    el.dataset.id = msg.id;
    el.dataset.name = msg.name;
    if (isOwnMessage(msg)) el.classList.add("mine");
    if (msg.pinned) el.classList.add("pinned-item");
    if (msg.admin || msg.name === "АДМИН") el.classList.add("admin");
    if (bulkSelectOn && bulkSelectedIds.has(msg.id)) el.classList.add("msg-bulk-selected");

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "msg-name";
    nameBtn.textContent = msg.name;
    nameBtn.title = "Пригласить в комнату";
    nameBtn.addEventListener("click", () => {
      const match = lastPeople.find((p) => p.name === msg.name && p.id !== socket.id);
      if (match) invitePerson(match);
      else {
        openOnlineList();
        notify(msg.name === myName ? "Это вы" : `${msg.name} сейчас не онлайн`)
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

      const goToReply = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const target = feed.querySelector(`[data-id="${CSS.escape(msg.reply.id)}"]`);
        if (!target) {
          notify("Оригинал не в ленте")
          return;
        }
        target.classList.add("pin-flash");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => target.classList.remove("pin-flash"), 1200);
      };

      // Isolate from outer bubble tap/menu logic.
      quote.addEventListener("pointerdown", (e) => e.stopPropagation());
      quote.addEventListener("pointerup", (e) => e.stopPropagation());
      quote.addEventListener("click", goToReply);
      quote.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToReply(e);
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
      img.draggable = false;
      el.append(img);
    }

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const activeWrap = document.createElement("div");
    activeWrap.className = "msg-reacts-active";
    const isOwn = isOwnMessage(msg);
    for (const { emoji, title } of REACTIONS) {
      const reactors = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
      if (!reactors.length) continue;
      const mine = reactors.includes(myName);
      const chip = document.createElement(isOwn ? "span" : "button");
      if (!isOwn) chip.type = "button";
      chip.className = "msg-react-chip" + (mine ? " mine" : "") + (isOwn ? " is-static" : "");
      chip.title = title;
      chip.textContent = reactors.length > 1 ? `${emoji}${reactors.length}` : emoji;
      if (!isOwn) {
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          applyReaction(msg.id, emoji);
        });
      }
      activeWrap.append(chip);
    }
    if (activeWrap.childElementCount) actions.append(activeWrap);

    // Desktop: double-tap ✕. On iPhone / touch: swipe left instead (avoids copy conflict).
    if (isAdmin && !prefersTouchAdminDelete()) {
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
          requestAdminDelete(msg.id);
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

    if (isAdmin && prefersTouchAdminDelete()) {
      const wrap = document.createElement("div");
      wrap.className = "msg-swipe";
      const rail = document.createElement("div");
      rail.className = "msg-swipe-rail";
      rail.setAttribute("aria-hidden", "true");
      rail.textContent = "Удалить";
      wrap.append(rail, el);
      bindAdminSwipeDelete(wrap, el, msg);
      return wrap;
    }

    return el;
  }

  function rewriteAuthorInMessages(list, fromName, toName) {
    if (!Array.isArray(list) || !fromName || !toName) return false;
    let touched = false;
    for (const msg of list) {
      if (!msg) continue;
      if (nameEquals(msg.name, fromName)) {
        msg.name = toName;
        touched = true;
      }
      if (msg.reply && nameEquals(msg.reply.name, fromName)) {
        msg.reply.name = toName;
        touched = true;
      }
      if (msg.reactions && typeof msg.reactions === "object") {
        for (const emoji of Object.keys(msg.reactions)) {
          const names = msg.reactions[emoji];
          if (!Array.isArray(names)) continue;
          let localTouch = false;
          const mapped = names.map((n) => {
            if (nameEquals(n, fromName)) {
              localTouch = true;
              return toName;
            }
            return n;
          });
          if (localTouch) {
            msg.reactions[emoji] = [...new Set(mapped)];
            if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
            touched = true;
          }
        }
      }
    }
    return touched;
  }

  function applyAuthorRename(fromName, toName) {
    if (!fromName || !toName || nameEquals(fromName, toName)) return;

    // Broadcast can arrive before the rename ack — keep myName in sync so .mine stays.
    const renamingSelf = Boolean(myName && nameEquals(myName, fromName));
    if (renamingSelf) {
      myName = toName;
      saveName(myName);
      syncMeBtn();
    }

    const stick = isNearBottom(80);
    const scrollTop = feed.scrollTop;
    const touchedMessages = rewriteAuthorInMessages(lastState.messages, fromName, toName);
    const touchedPins = rewriteAuthorInMessages(lastState.pinned, fromName, toName);

    // Remembered DM peers + pending invites that still show the old nick.
    try {
      const rooms = loadDmRooms();
      let roomsChanged = false;
      for (const room of rooms) {
        if (room.peer && nameEquals(room.peer, fromName)) {
          room.peer = toName;
          roomsChanged = true;
        }
        if (Array.isArray(room.names)) {
          let touched = false;
          room.names = room.names.map((n) => {
            if (!nameEquals(n, fromName)) return n;
            touched = true;
            return toName;
          });
          if (touched) roomsChanged = true;
        }
      }
      if (roomsChanged) saveDmRooms(rooms);
    } catch {
      /* ignore */
    }
    let invitesChanged = false;
    for (const inv of pendingInvites) {
      if (inv?.from && nameEquals(inv.from, fromName)) {
        inv.from = toName;
        invitesChanged = true;
      }
    }

    const refreshMine = renamingSelf || Boolean(myName && nameEquals(myName, toName));
    if (touchedMessages || touchedPins || refreshMine) {
      renderAll(lastState, { force: true, briefPin: true });
      if (!stick) {
        feed.scrollTop = scrollTop;
        updateJumpBottom();
      }
    } else {
      updatePinBar();
    }
    if (invitesChanged) renderInvitesList();
    if (dmDialog?.open) renderDmRoomsList({ skipRefresh: true });
  }

  function renderAll(state, { briefPin = false, force = false } = {}) {
    closeAllReactMenus();
    document.querySelectorAll("body > .msg-react-menu, body > .msg-action-menu").forEach((m) => m.remove());
    lastState = state || lastState;
    const { messages = [] } = lastState;

    updatePinBar();

    // Same transcript already on screen (e.g. leave room → chat:state echo).
    // Skip only when ids match — not after author renames (names changed, ids did not).
    if (!force && feedShowsMessages(messages)) {
      if (pinToLatestOnce) schedulePinToLatest({ brief: true });
      return;
    }

    const stick = pinToLatestOnce || isNearBottom(80);
    const scrollTop = feed.scrollTop;
    pinToLatestOnce = false;

    feed.replaceChildren();
    knownIds.clear();
    for (const msg of messages) {
      knownIds.add(msg.id);
      feed.append(renderMessage(msg));
    }

    if (stick) {
      schedulePinToLatest({ brief: briefPin });
    } else {
      feed.scrollTop = scrollTop;
      updateJumpBottom();
    }
  }

  function patchMessage(updated) {
    if (!updated?.id) return;
    const idx = (lastState.messages || []).findIndex((m) => m.id === updated.id);
    if (idx >= 0) lastState.messages[idx] = updated;
    const pinIdx = (lastState.pinned || []).findIndex((m) => m.id === updated.id);
    if (pinIdx >= 0) lastState.pinned[pinIdx] = updated;
    const el = feed.querySelector(`.msg[data-id="${CSS.escape(updated.id)}"]`);
    if (!el) return;
    const node = el.closest(".msg-swipe") || el;
    const next = renderMessage(updated);
    node.replaceWith(next);
  }

  function appendMessage(msg) {
    if (knownIds.has(msg.id)) return;
    knownIds.add(msg.id);
    lastState.messages = [...(lastState.messages || []), msg];
    const nearBottom = isNearBottom(120);
    const node = renderMessage(msg);
    const bubble = node.classList.contains("msg") ? node : node.querySelector(".msg");
    if (bubble) bubble.classList.add("msg-enter");
    feed.append(node);
    bubble?.addEventListener(
      "animationend",
      () => {
        bubble.classList.remove("msg-enter");
      },
      { once: true }
    );
    const stick = nearBottom || isOwnMessage(msg);
    if (stick) {
      scrollFeedToBottom(true);
      if (!document.hidden) clearUnreadBadge();
      const img = node.querySelector(".msg-photo");
      if (img && !img.complete) {
        img.addEventListener("load", () => scrollFeedToBottom(true), { once: true });
      }
    } else {
      updateJumpBottom();
    }
    noteIncomingMessage(msg);
  }

  function enterChat(name, { admin = false } = {}) {
    myName = name;
    saveName(name);
    gate.hidden = true;
    app.hidden = false;
    if (admin) setAdminUi(true, name);
    else if (isAdmin) setAdminUi(false);
    else syncMeBtn();
    // chat:state may have rendered before we knew our name — refresh .mine
    if (lastState?.messages?.length) renderAll(lastState);
    pinToLatestOnce = true;
    syncViewportHeight();
    if (notifyEnabled) void syncPushSubscription();
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
    notify("Загрузка фото…")
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
      notify("Фото готово к отправке")
    } catch (err) {
      notify(err.message || "Не удалось загрузить фото")
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
    if (lastNotice.includes("Фото")) hideAppToast();
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
        notify(res?.error || "Не отправилось")
        return;
      }
      messageInput.value = "";
      autoSize();
      clearPreview();
      clearReply();
      hideAppToast()
    });
  }

  randomBtn.addEventListener("click", () => {
    fetchRandomName(nameInput).catch(() => {});
  });

  function openRenameDialog() {
    if (isAdmin) {
      notify("В админке имя всегда АДМИН")
      return;
    }
    if (!renameDialog || !renameInput) return;
    renameInput.value = myName || "";
    renameDialog.showModal();
    layoutFormDialog(renameDialog);
    // Focus after layout; do not select-all (iOS showed blue handles as if user selected).
    requestAnimationFrame(() => {
      layoutFormDialog(renameDialog);
      try {
        renameInput.focus({ preventScroll: true });
      } catch {
        renameInput.focus();
      }
      try {
        const len = renameInput.value.length;
        renameInput.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
      keepDialogAboveKeyboard(renameDialog, renameInput);
    });
  }

  function applyRename() {
    const next = (renameInput?.value || "").trim();
    if (!next) {
      notify("Введите имя")
      return;
    }
    const previousName = myName;
    socket.emit("chat:rename", { name: next }, (res) => {
      if (!res?.ok) {
        notify(res?.error || "Не сменилось")
        return;
      }
      const from = res.from || previousName;
      const to = res.name;
      renameDialog?.close();
      // Rewrite + force-repaint before flipping myName helpers that gate .mine.
      applyAuthorRename(from, to);
      myName = to;
      saveName(myName);
      syncMeBtn();
      if (notifyEnabled) void syncPushSubscription();
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
      notify("Можно только изображения")
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
  bulkCancelBtn?.addEventListener("click", () => exitBulkSelectMode());
  bulkDeleteBtn?.addEventListener("click", () => deleteBulkSelected());

  appToast?.addEventListener("click", (e) => {
    if (e.target === appToast || e.target.classList?.contains("app-toast-scrim") || e.target === appToastText) {
      hideAppToast();
    }
  });

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
  invitesBtn?.addEventListener("click", () => openInvitesDialog());
  invitesCloseBtn?.addEventListener("click", () => closeInvitesDialog());
  invitesDialog?.addEventListener("click", (e) => {
    if (e.target === invitesDialog) closeInvitesDialog();
  });
  invitesDialog?.addEventListener("close", () => {
    invitesDialog.style.top = "";
    invitesDialog.style.bottom = "";
    invitesDialog.style.height = "";
    invitesDialog.style.maxHeight = "";
    invitesDialog.style.width = "";
    invitesDialog.style.maxWidth = "";
    invitesDialog.style.transform = "";
  });

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
    if (invitesDialog?.open) layoutBottomSheet(invitesDialog);
    if (dmDialog?.open) layoutDmDialog();
    if (renameDialog?.open) layoutFormDialog(renameDialog);
    if (adminDialog?.open) layoutFormDialog(adminDialog);
  };
  window.addEventListener("resize", onPinsViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onPinsViewport);
    window.visualViewport.addEventListener("scroll", onPinsViewport);
  }

  function clearPinTextSelection() {
    try {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch {
      /* ignore */
    }
  }

  pins.addEventListener("selectstart", (e) => {
    e.preventDefault();
  });
  pins.addEventListener(
    "touchstart",
    () => {
      clearPinTextSelection();
    },
    { passive: true }
  );
  pins.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearPinTextSelection();
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
      clearPinTextSelection();
      openPinsList();
      // iOS sometimes selects after the hold opens — clear again on next frames.
      requestAnimationFrame(clearPinTextSelection);
      setTimeout(clearPinTextSelection, 50);
      setTimeout(clearPinTextSelection, 180);
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
    e.stopPropagation();
    clearPinTextSelection();
    clearPinHold();
    pinHoldOpened = true;
    openPinsList();
  });
  pins.addEventListener("click", onPinBarClick);

  renameRandomBtn?.addEventListener("click", () => {
    fetchRandomName(renameInput).catch(() => {});
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
  lightboxClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    lightbox?.close();
  });

  let resetLightboxZoom = () => {};

  function openLightbox(url) {
    if (!lightbox || !lightboxImg || !url) return;
    resetLightboxZoom();
    lightboxImg.src = url;
    if (!lightbox.open) lightbox.showModal();
  }

  (function bindLightboxGallery() {
    if (!lightbox || !lightboxImg) return;

    const MIN = 1;
    const MAX = 4;
    let scale = 1;
    let tx = 0;
    let ty = 0;
    /** @type {Map<number, { x: number, y: number }>} */
    const pointers = new Map();
    let pinchStart = null;
    let panStart = null;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let moved = false;

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    const applyTransform = (withTransition) => {
      lightboxImg.style.transition = withTransition
        ? "transform 200ms cubic-bezier(0.33, 1, 0.68, 1)"
        : "none";
      lightboxImg.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    };

    const resetZoom = (animate = true) => {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform(animate);
      lightbox.classList.remove("is-zoomed");
    };
    resetLightboxZoom = () => resetZoom(false);

    const constrainPan = () => {
      if (scale <= 1.01) {
        tx = 0;
        ty = 0;
        return;
      }
      const vw = lightbox.clientWidth || window.innerWidth;
      const vh = lightbox.clientHeight || window.innerHeight;
      const baseW = lightboxImg.offsetWidth || 1;
      const baseH = lightboxImg.offsetHeight || 1;
      const boundX = Math.max(0, (baseW * scale - vw) / 2);
      const boundY = Math.max(0, (baseH * scale - vh) / 2);
      tx = clamp(tx, -boundX, boundX);
      ty = clamp(ty, -boundY, boundY);
    };

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    lightbox.addEventListener("close", () => {
      pointers.clear();
      pinchStart = null;
      panStart = null;
      resetZoom(false);
      lightboxImg.removeAttribute("src");
      syncViewportHeight();
    });

    lightboxImg.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        moved = false;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
          lightboxImg.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchStart = {
            dist: dist(a, b) || 1,
            scale,
            mid: mid(a, b),
            tx,
            ty,
          };
          panStart = null;
        } else if (pointers.size === 1 && scale > 1.01) {
          panStart = { x: e.clientX, y: e.clientY, tx, ty };
        }
      },
      { passive: true }
    );

    lightboxImg.addEventListener(
      "pointermove",
      (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2 && pinchStart) {
          const [a, b] = [...pointers.values()];
          const d = dist(a, b) || 1;
          scale = clamp(pinchStart.scale * (d / pinchStart.dist), MIN, MAX);
          const m = mid(a, b);
          tx = pinchStart.tx + (m.x - pinchStart.mid.x);
          ty = pinchStart.ty + (m.y - pinchStart.mid.y);
          constrainPan();
          applyTransform(false);
          lightbox.classList.toggle("is-zoomed", scale > 1.01);
          moved = true;
          return;
        }

        if (pointers.size === 1 && panStart && scale > 1.01) {
          const dx = e.clientX - panStart.x;
          const dy = e.clientY - panStart.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
          tx = panStart.tx + dx;
          ty = panStart.ty + dy;
          constrainPan();
          applyTransform(false);
        }
      },
      { passive: true }
    );

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        panStart = null;
        if (scale <= 1.01) resetZoom(true);
        else {
          constrainPan();
          applyTransform(true);
        }
      } else if (pointers.size === 1 && scale > 1.01) {
        const only = [...pointers.values()][0];
        panStart = { x: only.x, y: only.y, tx, ty };
      }
    };

    lightboxImg.addEventListener("pointerup", (e) => {
      const wasMoved = moved;
      endPointer(e);
      if (wasMoved || pointers.size > 0) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const now = Date.now();
      const dt = now - lastTapAt;
      const dx = Math.abs(e.clientX - lastTapX);
      const dy = Math.abs(e.clientY - lastTapY);
      if (dt < 320 && dx < 28 && dy < 28) {
        lastTapAt = 0;
        resetZoom(true);
        return;
      }
      lastTapAt = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    });

    lightboxImg.addEventListener("pointercancel", endPointer);

    lightboxImg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.12 : 0.12;
        const next = clamp(scale + delta, MIN, MAX);
        if (next === scale) return;
        scale = next;
        if (scale <= 1.01) resetZoom(false);
        else {
          constrainPan();
          applyTransform(false);
          lightbox.classList.add("is-zoomed");
        }
      },
      { passive: false }
    );

    lightbox.addEventListener(
      "gesturestart",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    lightbox.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false }
    );
  })();

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
      notify("Режим админа · ник АДМИН")
    });
  }

  let meTapCount = 0;
  let meTapTimer = null;
  let meRenameTimer = null;
  const ME_TAP_NEED = 10;
  const ME_TAP_WINDOW_MS = 2000;
  const ME_RENAME_DELAY_MS = 320;

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
      dmBtn.textContent = "Комната";
      dmBtn.title = "Меню комнат · вы в комнате";
      dmBtn.classList.add("active");
    } else {
      dmBtn.textContent = "Комната";
      dmBtn.title = "Комната по коду · до 100 человек";
      dmBtn.classList.remove("active");
    }
    if (dmDialog?.open) syncDmDialogChrome();
  }

  dmBtn?.addEventListener("click", () => {
    openDmDialog();
  });
  dmLeavePublicBtn?.addEventListener("click", () => {
    leaveDmMode();
    syncDmBtn();
    void closeDmDialogSoft();
  });
  dmDialogClose?.addEventListener("click", () => {
    void closeDmDialogSoft();
  });
  dmCreateBtn?.addEventListener("click", () => {
    showDmDialogError("");
    socket.emit("dm:create", {}, (res) => {
      if (!res?.ok) {
        showDmDialogError(res?.error || "Не создалось");
        return;
      }
      enterDmMode(res);
      void closeDmDialogSoft();
      notify(`Код ${res.code} — поделитесь с участниками`);
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
    clearForgetArm();
    dmDialog.classList.remove("is-leaving");
    dmDialog.removeAttribute("style");
  });
  dmCodeInput?.addEventListener("focus", () => keepDialogAboveKeyboard(dmDialog, dmCodeInput));
  dmCopyBtn?.addEventListener("click", async () => {
    if (!dmCode) return;
    try {
      await navigator.clipboard.writeText(dmCode);
      notify(`Код ${dmCode} скопирован`)
    } catch {
      notify(`Код: ${dmCode}`)
    }
  });

  socket.on("chat:author-renamed", ({ from, to } = {}) => {
    if (!from || !to) return;
    applyAuthorRename(from, to);
  });

  socket.on("chat:state", (state) => {
    if (dmCode) return;
    // State often arrives while the gate is up; scrolling a hidden feed is lost
    // when #app becomes visible, so remember to land on the newest messages.
    if (app.hidden) pinToLatestOnce = true;
    lastState = state || lastState;
    // Prefer painting after we know myName so own bubbles get .mine.
    if (!myName) return;
    renderAll(lastState);
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
    markDmRoomRead(dmCode, lastState.messages || [], {
      peer: msg?.name && msg.name !== myName ? msg.name : undefined,
    });
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

  function leaveToGate(reason) {
    myName = "";
    isAdmin = false;
    dmCode = null;
    pendingInvites = [];
    exitBulkSelectMode();
    syncInvitesBtn();
    closeInvitesDialog();
    document.body.classList.remove("dm-on", "admin-on");
    if (dmBar) dmBar.hidden = true;
    closeOnlineList();
    closeAllReactMenus();
    app.hidden = true;
    gate.hidden = false;
    syncMeBtn();
    syncDmBtn();
    if (reason) showGateError(reason);
  }

  socket.on("chat:kicked", ({ reason } = {}) => {
    leaveToGate(reason || "Сессия закрыта — это имя открыто в другой вкладке");
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
    queueInvite({
      code: payload.code,
      from: payload.from || "Кто-то",
      fromId: payload.fromId || "",
    });
  });

  socket.on("dm:invite-declined", ({ name } = {}) => {
    notify(`${name || "Участник"} отклонил приглашение`)
  });

  socket.on("dm:room-gone", (payload = {}) => {
    const code = String(payload.code || "");
    if (code) forgetDmRoom(code);
    if (dmCode && code && dmCode === code) {
      leaveDmMode();
      notify("Комната удалена · 90 дней без сообщений");
    }
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
    if (!e.target.closest(".msg.msg-selecting")) {
      document.querySelectorAll(".msg.msg-selecting").forEach((node) => {
        node.classList.remove("msg-selecting");
      });
    }
  });
  window.addEventListener("resize", closeAllReactMenus);
  feed.addEventListener("scroll", closeAllReactMenus, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllReactMenus();
  });

  // ——— Notifications: Home Screen badge + Web Push (iOS 16.4+ / Android / desktop) ———
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-ignore
    window.navigator.standalone === true;

  let swReg = null;
  let notifyEnabled = false;
  let notifyPublic = true;
  let notifyDm = true;
  let unreadBadge = 0;

  function loadBoolPref(key, fallback = true) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw !== "0";
    } catch {
      return fallback;
    }
  }

  function saveBoolPref(key, on) {
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function loadNotifyPref() {
    return loadBoolPref(NOTIFY_KEY, true);
  }

  function saveNotifyPref(on) {
    saveBoolPref(NOTIFY_KEY, on);
  }

  function loadNotifyChannels() {
    notifyPublic = loadBoolPref(NOTIFY_PUBLIC_KEY, true);
    notifyDm = loadBoolPref(NOTIFY_DM_KEY, true);
  }

  function saveNotifyChannels() {
    saveBoolPref(NOTIFY_PUBLIC_KEY, notifyPublic);
    saveBoolPref(NOTIFY_DM_KEY, notifyDm);
  }

  function syncNotifyMenuInputs() {
    if (notifyPublicInput) notifyPublicInput.checked = notifyPublic;
    if (notifyDmInput) notifyDmInput.checked = notifyDm;
  }

  function setNotifyMenuOpen(open) {
    if (!notifyMenu || !notifyBtn) return;
    notifyMenu.hidden = !open;
    notifyBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeNotifyMenu() {
    setNotifyMenuOpen(false);
  }

  function syncNotifyBtn() {
    if (!notifyBtn) return;
    const anyChannel = notifyPublic || notifyDm;
    const on = notifyEnabled && anyChannel;
    notifyBtn.classList.toggle("is-on", on);
    notifyBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (!notifyEnabled) {
      notifyBtn.title = "Включить уведомления";
    } else if (!anyChannel) {
      notifyBtn.title = "Уведомления выключены";
    } else if (notifyPublic && notifyDm) {
      notifyBtn.title = "Уведомления: общий и комнаты";
    } else if (notifyPublic) {
      notifyBtn.title = "Уведомления: только общий чат";
    } else {
      notifyBtn.title = "Уведомления: только комнаты";
    }
    syncNotifyMenuInputs();
  }

  async function setUnreadBadge(n) {
    unreadBadge = Math.max(0, Math.floor(n) || 0);
    try {
      if (unreadBadge > 0) {
        if (navigator.setAppBadge) await navigator.setAppBadge(unreadBadge);
        else if (swReg?.setAppBadge) await swReg.setAppBadge(unreadBadge);
      } else if (navigator.clearAppBadge) {
        await navigator.clearAppBadge();
      } else if (swReg?.clearAppBadge) {
        await swReg.clearAppBadge();
      }
    } catch {
      /* ignore */
    }
  }

  function clearUnreadBadge() {
    void setUnreadBadge(0);
  }

  function bumpUnreadBadge() {
    void setUnreadBadge(unreadBadge + 1);
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
    if (swReg) return swReg;
    swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return swReg;
  }

  async function syncPushSubscription() {
    try {
      const reg = await ensureServiceWorker();
      if (!reg?.pushManager) return false;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      const keyRes = await fetch("/api/vapid-public-key");
      const { publicKey } = await keyRes.json();
      if (!publicKey) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          name: myName || "",
          notifyPublic,
          notifyDm,
        }),
      });
      return true;
    } catch (err) {
      console.warn("push subscribe failed", err);
      return false;
    }
  }

  async function enableNotifications({ openMenu = true } = {}) {
    if (isIos && !isStandalone) {
      notify(
        "iPhone: Safari → Поделиться → На экран «Домой» → открыть с иконки → снова 🔔. В Настройках → Сарафан включите Уведомления."
      );
      return false;
    }
    if (typeof Notification === "undefined") {
      notify(isIos ? "Нужен iOS 16.4+ и ярлык с Safari" : "Уведомления недоступны");
      return false;
    }
    if (Notification.permission === "denied") {
      notify(
        isIos
          ? "Настройки → Сарафан → Уведомления → разрешить"
          : "Уведомления запрещены в настройках браузера"
      );
      return false;
    }
    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        notify(
          isIos
            ? "Разрешите уведомления в окне или в Настройки → Сарафан"
            : "Без разрешения пуши не придут"
        );
        return false;
      }
    }
    if (!notifyPublic && !notifyDm) {
      notifyPublic = true;
      notifyDm = true;
      saveNotifyChannels();
    }
    await ensureServiceWorker();
    const pushed = await syncPushSubscription();
    notifyEnabled = true;
    saveNotifyPref(true);
    syncNotifyBtn();
    notify(pushed ? "Уведомления включены" : "Разрешено, но push пока недоступен");
    if (openMenu) setNotifyMenuOpen(true);
    return true;
  }

  async function disableNotifications() {
    notifyEnabled = false;
    saveNotifyPref(false);
    closeNotifyMenu();
    syncNotifyBtn();
    clearUnreadBadge();
    try {
      const reg = await ensureServiceWorker();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch("/api/push-unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    notify("Уведомления выключены");
  }

  async function applyNotifyChannels() {
    saveNotifyChannels();
    syncNotifyBtn();
    if (!notifyPublic && !notifyDm) {
      await disableNotifications();
      return;
    }
    if (!notifyEnabled) {
      await enableNotifications({ openMenu: false });
      return;
    }
    await syncPushSubscription();
  }

  async function onNotifyBtnClick() {
    if (notifyEnabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const open = Boolean(notifyMenu?.hidden);
      setNotifyMenuOpen(open);
      return;
    }
    await enableNotifications({ openMenu: true });
  }

  function noteIncomingMessage(msg) {
    if (!msg || isOwnMessage(msg)) return;
    const hidden = document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus());
    const away = hidden || !isNearBottom(120);
    if (!away) {
      clearUnreadBadge();
      return;
    }
    bumpUnreadBadge();
  }

  notifyBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void onNotifyBtnClick();
  });

  notifyPublicInput?.addEventListener("change", () => {
    notifyPublic = Boolean(notifyPublicInput.checked);
    void applyNotifyChannels();
  });

  notifyDmInput?.addEventListener("change", () => {
    notifyDm = Boolean(notifyDmInput.checked);
    void applyNotifyChannels();
  });

  notifyOffBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void disableNotifications();
  });

  document.addEventListener("click", (event) => {
    if (!notifyMenu || notifyMenu.hidden) return;
    const wrap = notifyBtn?.closest(".notify-wrap");
    if (wrap && wrap.contains(event.target)) return;
    closeNotifyMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNotifyMenu();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (isNearBottom(160)) clearUnreadBadge();
      if (notifyEnabled && myName) void syncPushSubscription();
    }
  });

  feed.addEventListener(
    "scroll",
    () => {
      if (!document.hidden && isNearBottom(80)) clearUnreadBadge();
    },
    { passive: true }
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "open-from-notify" && data.id) {
        clearUnreadBadge();
        const el = feed.querySelector(`.msg[data-id="${CSS.escape(data.id)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  loadNotifyChannels();
  notifyEnabled =
    loadNotifyPref() &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted";
  syncNotifyBtn();
  if (notifyEnabled) {
    void ensureServiceWorker().then(() => {
      if (myName) void syncPushSubscription();
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
