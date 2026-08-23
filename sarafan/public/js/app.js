import {
  load,
  save,
  clientId,
  normalizePin,
  normalizeCode,
  loadRooms,
  rememberRoom,
  forgetRoom,
  loadRoomKey,
  saveRoomKey,
} from "./storage.js";
import { toast, showError, bindTap, bindLongPress, syncViewport, layoutHub } from "./ui.js";
import { syncPush, toggleNotify, syncNotifyBtn, notifyEnabled } from "./push.js";

const PUBLIC_CODE = "000000";
const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮"];

const $ = (id) => document.getElementById(id);

const gate = $("gate");
const app = $("app");
const nameInput = $("name-input");
const pinInput = $("pin-input");
const joinBtn = $("join-btn");
const randomBtn = $("random-btn");
const gateError = $("gate-error");
const brandBtn = $("brand-btn");
const adminDialog = $("admin-dialog");
const adminPassword = $("admin-password");
const adminSubmit = $("admin-submit");
const adminError = $("admin-error");

const hubDialog = $("hub-dialog");
const hubClose = $("hub-close");
const hubError = $("hub-error");
const hubList = $("hub-list");
const hubListTitle = $("hub-list-title");
const createCode = $("create-code");
const createKey = $("create-key");
const createBtn = $("create-btn");
const joinCode = $("join-code");
const joinKey = $("join-key");
const joinRoomBtn = $("join-room-btn");

const hubBtn = $("hub-btn");
const meBtn = $("me-btn");
const presenceBtn = $("presence-btn");
const notifyBtn = $("notify-btn");
const roomBar = $("room-bar");
const roomCodeLabel = $("room-code-label");
const roomMeta = $("room-meta");
const roomSettingsBtn = $("room-settings-btn");
const leaveRoomBtn = $("leave-room-btn");
const pinsEl = $("pins");
const feed = $("feed");
const messageInput = $("message-input");
const sendBtn = $("send-btn");
const fileInput = $("file-input");
const pendingImage = $("pending-image");
const replyBar = $("reply-bar");
const replyPreview = $("reply-preview");
const replyCancel = $("reply-cancel");

const settingsDialog = $("settings-dialog");
const settingsLead = $("settings-lead");
const settingsPin = $("settings-pin");
const settingsKey = $("settings-key");
const settingsError = $("settings-error");
const makeOpenBtn = $("make-open-btn");
const makeKeyedBtn = $("make-keyed-btn");
const toggleCloseBtn = $("toggle-close-btn");
const deleteCode = $("delete-code");
const deleteRoomBtn = $("delete-room-btn");
const settingsClose = $("settings-close");

const renameDialog = $("rename-dialog");
const renameInput = $("rename-input");
const renameSubmit = $("rename-submit");
const renameCancel = $("rename-cancel");
const renameError = $("rename-error");

const presenceDialog = $("presence-dialog");
const presenceList = $("presence-list");
const presenceClose = $("presence-close");

const socket = io({ autoConnect: true, transports: ["websocket", "polling"] });

let myName = "";
let isAdmin = false;
let roomCode = null;
let isOwner = false;
let roomKeyed = false;
let roomClosed = false;
let publicLabel = "Сарафан ВПН";
let pendingImageUrl = "";
let pendingReply = null;
let people = [];
let adminCatalog = [];
let createBusy = false;
let joinBusy = false;
let knownIds = new Set();

function digitsOnly(el, max) {
  el?.addEventListener("input", () => {
    const v = String(el.value || "").replace(/\D/g, "").slice(0, max);
    if (el.value !== v) el.value = v;
  });
}

digitsOnly(pinInput, 4);
digitsOnly(createCode, 6);
digitsOnly(createKey, 4);
digitsOnly(joinCode, 6);
digitsOnly(joinKey, 4);
digitsOnly(settingsPin, 4);
digitsOnly(settingsKey, 4);
digitsOnly(deleteCode, 6);

function setAdminUi(on, name) {
  isAdmin = on;
  document.body.classList.toggle("admin-on", on);
  if (name) {
    myName = name;
    save("name", name);
  }
  syncMe();
}

function syncMe() {
  if (!meBtn) return;
  meBtn.textContent = myName || "…";
  meBtn.classList.toggle("is-admin", isAdmin);
  meBtn.title = isAdmin ? "Супер-админ · нажмите, чтобы выйти" : `Вы: ${myName}`;
}

function enterApp() {
  gate.hidden = true;
  app.hidden = false;
  syncNotifyBtn(notifyBtn);
  openHub();
}

function leaveToGate(reason) {
  myName = "";
  isAdmin = false;
  roomCode = null;
  app.hidden = true;
  gate.hidden = false;
  hubDialog?.close();
  if (reason) showError(gateError, reason);
}

function openHub() {
  showError(hubError, "");
  renderHubList();
  if (isAdmin) refreshCatalog();
  hubDialog.showModal();
  layoutHub(hubDialog);
}

function closeHub() {
  if (hubDialog.open) hubDialog.close();
}

function renderHubList() {
  if (!hubList) return;
  hubList.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Public chat row
  frag.appendChild(roomRow({
    code: PUBLIC_CODE,
    label: publicLabel,
    messageCount: loadRooms().find((r) => r.code === PUBLIC_CODE)?.messageCount || 0,
    isPublic: true,
  }));

  const rooms = isAdmin
    ? mergeAdminRooms()
    : loadRooms().filter((r) => r.code !== PUBLIC_CODE);

  hubListTitle.textContent = isAdmin ? "Все комнаты" : "Ваши комнаты";

  for (const room of rooms) {
    frag.appendChild(roomRow(room));
  }

  if (!rooms.length && !isAdmin) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Пока нет сохранённых комнат — создайте или войдите по номеру";
    frag.appendChild(empty);
  }

  hubList.appendChild(frag);
}

function mergeAdminRooms() {
  const map = new Map();
  for (const r of loadRooms()) {
    if (r.code === PUBLIC_CODE) continue;
    map.set(r.code, { ...r, foreign: false });
  }
  for (const r of adminCatalog) {
    const prev = map.get(r.code) || {};
    map.set(r.code, { ...prev, ...r, foreign: true });
  }
  return [...map.values()].sort((a, b) => String(b.lastActiveAt || "").localeCompare(String(a.lastActiveAt || "")));
}

function roomRow(room) {
  const row = document.createElement("div");
  row.className = "hub-row";
  row.setAttribute("role", "listitem");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hub-enter" + (roomCode === room.code ? " is-current" : "");
  const title = document.createElement("strong");
  title.textContent = room.isPublic || room.code === PUBLIC_CODE ? publicLabel : room.code;
  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [];
  if (room.keyed) parts.push("закрытая");
  if (room.closed) parts.push("вход закрыт");
  if (room.foreign && isAdmin) parts.push("чужая");
  parts.push(`${Number(room.messageCount) || 0} сообщ.`);
  meta.textContent = parts.join(" · ");
  btn.append(title, meta);
  btn.addEventListener("click", () => {
    const key = loadRoomKey(room.code) || joinKey?.value || "";
    enterRoom(room.code, key);
  });

  row.append(btn);

  if (!room.isPublic && room.code !== PUBLIC_CODE) {
    const x = document.createElement("button");
    x.type = "button";
    x.className = "hub-forget";
    x.title = isAdmin && room.foreign ? "Удалить комнату навсегда" : "Убрать из списка";
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isAdmin && room.foreign) {
        if (!confirm(`Удалить комнату ${room.code} навсегда?`)) return;
        socket.emit("room:delete", { code: room.code }, (res) => {
          if (!res?.ok) {
            toast(res?.error || "Не удалилось");
            return;
          }
          forgetRoom(room.code);
          adminCatalog = adminCatalog.filter((r) => r.code !== room.code);
          renderHubList();
          toast(`Комната ${room.code} удалена`);
        });
        return;
      }
      forgetRoom(room.code);
      renderHubList();
    });
    row.append(x);
  }

  return row;
}

function refreshCatalog() {
  socket.emit("rooms:list", {}, (res) => {
    if (!res?.ok) return;
    adminCatalog = res.rooms || [];
    renderHubList();
  });
}

function enterRoom(code, key = "") {
  const c = normalizeCode(code);
  if (c.length !== 6) {
    showError(hubError, "Нужен номер из 6 цифр");
    return;
  }
  if (joinBusy) return;
  joinBusy = true;
  if (joinRoomBtn) joinRoomBtn.disabled = true;
  socket.timeout(10000).emit("room:join", { code: c, key: normalizePin(key) || undefined }, (err, res) => {
    joinBusy = false;
    if (joinRoomBtn) joinRoomBtn.disabled = false;
    if (err) {
      showError(hubError, "Нет связи");
      return;
    }
    if (!res?.ok) {
      showError(hubError, res?.error || "Не удалось войти");
      if (res?.needsKey) joinKey?.focus();
      return;
    }
    if (normalizePin(key)) saveRoomKey(c, key);
    applyRoom(res);
    closeHub();
  });
}

function createRoom() {
  if (createBusy) return;
  if (!socket.connected) {
    showError(hubError, "Нет связи");
    return;
  }
  const pin = normalizePin(load("pin"));
  if (pin.length !== 4 && !isAdmin) {
    showError(hubError, "Нужен пин аккаунта");
    return;
  }
  const preferred = normalizeCode(createCode?.value || "");
  const key = normalizePin(createKey?.value || "");
  if (String(createCode?.value || "").replace(/\D/g, "") && preferred.length !== 6) {
    showError(hubError, "Номер — 6 цифр или пусто");
    return;
  }
  if (String(createKey?.value || "").replace(/\D/g, "") && key.length !== 4) {
    showError(hubError, "Ключ — 4 цифры или пусто");
    return;
  }
  createBusy = true;
  if (createBtn) createBtn.disabled = true;
  toast("Создаём комнату…");
  const payload = { joinKey: key };
  if (preferred.length === 6) payload.code = preferred;
  socket.timeout(10000).emit("room:create", payload, (err, res) => {
    createBusy = false;
    if (createBtn) createBtn.disabled = false;
    if (err) {
      showError(hubError, "Нет связи");
      return;
    }
    if (!res?.ok) {
      showError(hubError, res?.error || "Не создалось");
      return;
    }
    if (key) saveRoomKey(res.code, key);
    if (createCode) createCode.value = "";
    if (createKey) createKey.value = "";
    applyRoom(res);
    closeHub();
    toast(
      res.remapped
        ? `Номер занят · выдан ${res.code}`
        : key
          ? `Комната ${res.code} · ключ ${key}`
          : `Комната ${res.code} · открытая`
    );
  });
}

function applyRoom(res) {
  roomCode = res.code;
  isOwner = Boolean(res.isOwner);
  roomKeyed = Boolean(res.keyed);
  roomClosed = Boolean(res.closed);
  knownIds = new Set();
  rememberRoom(roomCode, {
    keyed: roomKeyed,
    closed: roomClosed,
    messageCount: (res.messages || []).length,
  });
  if (roomBar) roomBar.hidden = false;
  if (roomCodeLabel) {
    roomCodeLabel.textContent =
      roomCode === PUBLIC_CODE ? publicLabel : `№ ${roomCode}`;
  }
  syncRoomMeta(res);
  if (roomSettingsBtn) {
    roomSettingsBtn.hidden = !(isOwner || isAdmin) || roomCode === PUBLIC_CODE;
  }
  renderFeed(res.messages || [], res.pinned || []);
  messageInput.placeholder = isAdmin ? "Сообщение от АДМИН" : "Сообщение";
}

function syncRoomMeta(res = {}) {
  if (!roomMeta) return;
  const parts = [];
  if (res.count != null) parts.push(`онлайн ${res.count}`);
  if (roomKeyed) parts.push("закрытая");
  if (roomClosed) parts.push("вход закрыт");
  if (isOwner) parts.push("вы владелец");
  if (isAdmin) parts.push("супер");
  roomMeta.textContent = parts.join(" · ");
}

function leaveRoom() {
  socket.emit("room:leave", {}, () => {
    roomCode = null;
    isOwner = false;
    if (roomBar) roomBar.hidden = true;
    feed.innerHTML = "";
    pinsEl.hidden = true;
    pinsEl.innerHTML = "";
    openHub();
  });
}

function renderFeed(messages, pinned = []) {
  feed.innerHTML = "";
  knownIds = new Set();
  for (const msg of messages) appendMessage(msg, false);
  renderPins(pinned);
  feed.scrollTop = feed.scrollHeight;
}

function renderPins(pinned) {
  if (!pinsEl) return;
  pinsEl.innerHTML = "";
  if (!pinned?.length) {
    pinsEl.hidden = true;
    return;
  }
  pinsEl.hidden = false;
  for (const msg of pinned) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pin-card";
    card.textContent = `${msg.name}: ${(msg.text || "фото").slice(0, 80)}`;
    card.addEventListener("click", () => {
      const el = feed.querySelector(`[data-id="${CSS.escape(msg.id)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    pinsEl.append(card);
  }
}

function appendMessage(msg, scroll = true) {
  if (!msg?.id || knownIds.has(msg.id)) return;
  knownIds.add(msg.id);
  const el = document.createElement("article");
  el.className = "msg";
  el.dataset.id = msg.id;
  if (msg.name === myName) el.classList.add("mine");
  if (msg.admin) el.classList.add("admin");

  const name = document.createElement("div");
  name.className = "msg-name";
  name.textContent = msg.admin ? `${msg.name} · супер` : msg.roomAdmin ? `${msg.name} · владелец` : msg.name;

  if (msg.replyTo) {
    const rep = document.createElement("div");
    rep.className = "msg-reply";
    rep.textContent = `${msg.replyTo.name}: ${msg.replyTo.text || "фото"}`;
    el.append(rep);
  }

  el.append(name);

  if (msg.text) {
    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = msg.text;
    el.append(text);
  }
  if (msg.imageUrl) {
    const img = document.createElement("img");
    img.src = msg.imageUrl;
    img.alt = "фото";
    img.loading = "lazy";
    el.append(img);
  }

  const reactions = document.createElement("div");
  reactions.className = "reactions";
  reactions.dataset.role = "reactions";
  renderReactions(reactions, msg.reactions || {}, msg.id);
  el.append(reactions);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const replyBtn = document.createElement("button");
  replyBtn.type = "button";
  replyBtn.textContent = "Ответить";
  replyBtn.addEventListener("click", () => setReply(msg));
  actions.append(replyBtn);
  for (const emoji of REACTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = emoji;
    b.addEventListener("click", () => {
      socket.emit("chat:react", { id: msg.id, emoji });
    });
    actions.append(b);
  }
  if (isOwner || isAdmin) {
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.textContent = "📌";
    pinBtn.addEventListener("click", () => socket.emit("chat:pin", { id: msg.id, pin: true }));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Удалить";
    delBtn.addEventListener("click", () => socket.emit("chat:delete", { id: msg.id }));
    actions.append(pinBtn, delBtn);
  }
  el.append(actions);

  feed.append(el);
  if (scroll && nearBottom()) feed.scrollTop = feed.scrollHeight;

  rememberRoom(roomCode, {
    messageCount: knownIds.size,
    keyed: roomKeyed,
    closed: roomClosed,
  });
}

function renderReactions(container, reactions, id) {
  container.innerHTML = "";
  for (const [emoji, users] of Object.entries(reactions || {})) {
    if (!users?.length) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reaction";
    b.textContent = `${emoji} ${users.length}`;
    b.addEventListener("click", () => socket.emit("chat:react", { id, emoji }));
    container.append(b);
  }
}

function nearBottom() {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
}

function setReply(msg) {
  pendingReply = {
    id: msg.id,
    name: msg.name,
    text: (msg.text || "фото").slice(0, 120),
  };
  replyBar.hidden = false;
  replyPreview.textContent = `${msg.name}: ${pendingReply.text}`;
  messageInput.focus();
}

function clearReply() {
  pendingReply = null;
  replyBar.hidden = true;
  replyPreview.textContent = "";
}

function autoSize() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(120, Math.max(42, messageInput.scrollHeight))}px`;
}

function sendMessage() {
  if (!roomCode) {
    openHub();
    return;
  }
  const text = messageInput.value.trim();
  if (!text && !pendingImageUrl) return;
  const payload = {
    text,
    imageUrl: pendingImageUrl || undefined,
    replyTo: pendingReply || undefined,
  };
  socket.timeout(10000).emit("chat:message", payload, (err, res) => {
    if (err || !res?.ok) {
      toast(res?.error || "Не отправилось");
      return;
    }
    messageInput.value = "";
    autoSize();
    pendingImageUrl = "";
    pendingImage.hidden = true;
    pendingImage.textContent = "";
    clearReply();
  });
}

async function uploadImage(file) {
  const body = new FormData();
  body.append("image", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "upload failed");
  return data.url;
}

function doJoin(nameOverride) {
  showError(gateError, "");
  const name = (nameOverride ?? nameInput.value).trim();
  const pin = normalizePin(pinInput.value || load("pin"));
  const adminToken = load("adminToken");
  const previousName = load("prevName");
  if (!adminToken) {
    if (!name) {
      showError(gateError, "Введите имя");
      return;
    }
    if (pin.length !== 4) {
      showError(gateError, "Нужен пин из 4 цифр");
      return;
    }
  }
  socket.emit(
    "chat:join",
    {
      name: name === "АДМИН" ? previousName || name : name,
      pin: pin.length === 4 ? pin : undefined,
      clientId: clientId(),
      adminToken: adminToken || undefined,
      previousName: previousName || undefined,
    },
    (res) => {
      if (!res?.ok) {
        if (adminToken) save("adminToken", "");
        showError(gateError, res?.error || "Не удалось войти");
        return;
      }
      myName = res.name;
      save("name", myName);
      if (pin.length === 4) save("pin", pin);
      if (res.publicLabel) publicLabel = res.publicLabel;
      if (res.admin) {
        if (res.previousName) save("prevName", res.previousName);
        setAdminUi(true, res.name);
      } else {
        setAdminUi(false, res.name);
      }
      if (Array.isArray(res.ownedRooms)) {
        for (const code of res.ownedRooms) rememberRoom(code);
      }
      enterApp();
      if (notifyEnabled()) void syncPush(myName);
      const want = new URLSearchParams(location.search).get("room");
      if (want) enterRoom(want, loadRoomKey(want));
    }
  );
}

// Gate
bindTap(joinBtn, () => doJoin());
randomBtn?.addEventListener("click", () => {
  socket.emit("chat:random-name", {}, (res) => {
    if (res?.ok && nameInput) nameInput.value = res.name;
  });
});
pinInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doJoin();
});
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") pinInput?.focus();
});

bindLongPress(brandBtn, () => {
  showError(adminError, "");
  if (adminPassword) adminPassword.value = "";
  adminDialog?.showModal();
  adminPassword?.focus();
}, 700);

adminSubmit?.addEventListener("click", () => {
  const password = (adminPassword?.value || "").trim();
  if (!password) {
    showError(adminError, "Введите пароль");
    return;
  }
  // Need to be joined first for admin:login — if still on gate, join then login.
  const finish = () => {
    if (myName && myName !== "АДМИН") save("prevName", myName);
    socket.emit("admin:login", { password }, (res) => {
      if (!res?.ok) {
        showError(adminError, res?.error || "Ошибка");
        return;
      }
      if (res.token) save("adminToken", res.token);
      if (res.previousName) save("prevName", res.previousName);
      setAdminUi(true, res.name);
      adminDialog.close();
      if (app.hidden) enterApp();
      toast("Режим супер-админа");
    });
  };
  if (!myName) {
    const name = nameInput.value.trim() || load("name") || "Гость";
    const pin = normalizePin(pinInput.value || load("pin"));
    if (pin.length !== 4) {
      showError(adminError, "Сначала укажите ник и пин на входе");
      return;
    }
    socket.emit("chat:join", { name, pin, clientId: clientId() }, (res) => {
      if (!res?.ok) {
        showError(adminError, res?.error || "Сначала войдите");
        return;
      }
      myName = res.name;
      save("name", myName);
      save("pin", pin);
      finish();
    });
    return;
  }
  finish();
});

// Hub
bindTap(hubBtn, () => openHub());
hubClose?.addEventListener("click", () => {
  if (!roomCode) {
    toast("Выберите комнату");
    return;
  }
  closeHub();
});
hubDialog?.addEventListener("cancel", (e) => {
  if (!roomCode) {
    e.preventDefault();
    toast("Выберите комнату");
  }
});
bindTap(createBtn, createRoom);
bindTap(joinRoomBtn, () => enterRoom(joinCode?.value || "", joinKey?.value || ""));
[createCode, createKey].forEach((el) => {
  el?.addEventListener("focus", () => layoutHub(hubDialog));
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoom();
  });
});
[joinCode, joinKey].forEach((el) => {
  el?.addEventListener("focus", () => layoutHub(hubDialog));
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enterRoom(joinCode?.value || "", joinKey?.value || "");
  });
});

leaveRoomBtn?.addEventListener("click", leaveRoom);
roomSettingsBtn?.addEventListener("click", () => {
  showError(settingsError, "");
  settingsLead.textContent = `№ ${roomCode}${roomKeyed ? " · закрытая" : " · открытая"}${
    roomClosed ? " · вход закрыт" : ""
  }`;
  settingsPin.value = load("pin") || "";
  settingsKey.value = loadRoomKey(roomCode) || "";
  deleteCode.value = roomCode || "";
  makeOpenBtn.hidden = !roomKeyed;
  makeKeyedBtn.hidden = roomKeyed;
  toggleCloseBtn.textContent = roomClosed ? "Открыть вход снова" : "Закрыть вход · выгнать";
  settingsDialog.showModal();
});
settingsClose?.addEventListener("click", () => settingsDialog.close());

makeOpenBtn?.addEventListener("click", () => {
  socket.emit(
    "room:set-access",
    { access: "open", confirmPin: settingsPin.value },
    (res) => {
      if (!res?.ok) return showError(settingsError, res?.error || "Не вышло");
      roomKeyed = false;
      saveRoomKey(roomCode, "");
      toast("Комната открыта");
      settingsDialog.close();
      syncRoomMeta();
    }
  );
});
makeKeyedBtn?.addEventListener("click", () => {
  const key = normalizePin(settingsKey.value);
  socket.emit(
    "room:set-access",
    { access: "keyed", joinKey: key, confirmPin: settingsPin.value },
    (res) => {
      if (!res?.ok) return showError(settingsError, res?.error || "Не вышло");
      roomKeyed = true;
      saveRoomKey(roomCode, key);
      toast(`Ключ комнаты: ${key}`);
      settingsDialog.close();
      syncRoomMeta();
    }
  );
});
toggleCloseBtn?.addEventListener("click", () => {
  socket.emit("room:close", { close: !roomClosed }, (res) => {
    if (!res?.ok) return showError(settingsError, res?.error || "Не вышло");
    roomClosed = Boolean(res.closed);
    toast(roomClosed ? "Вход закрыт" : "Вход снова открыт");
    toggleCloseBtn.textContent = roomClosed ? "Открыть вход снова" : "Закрыть вход · выгнать";
    syncRoomMeta();
  });
});
deleteRoomBtn?.addEventListener("click", () => {
  const code = normalizeCode(deleteCode.value || roomCode);
  if (!confirm(`Удалить комнату ${code} навсегда?`)) return;
  socket.emit(
    "room:delete",
    { code, confirmPin: isAdmin ? undefined : settingsPin.value },
    (res) => {
      if (!res?.ok) return showError(settingsError, res?.error || "Не удалилось");
      forgetRoom(code);
      settingsDialog.close();
      roomCode = null;
      roomBar.hidden = true;
      feed.innerHTML = "";
      toast(`Комната ${code} удалена`);
      openHub();
    }
  );
});

meBtn?.addEventListener("click", () => {
  if (isAdmin) {
    const token = load("adminToken");
    const prev = load("prevName");
    socket.emit("admin:logout", { token, name: prev }, (res) => {
      save("adminToken", "");
      if (!res?.ok) return toast(res?.error || "Не вышло");
      setAdminUi(false, res.name);
      toast(`Снова ${res.name}`);
    });
    return;
  }
  renameInput.value = myName;
  showError(renameError, "");
  renameDialog.showModal();
});
renameCancel?.addEventListener("click", () => renameDialog.close());
renameSubmit?.addEventListener("click", () => {
  socket.emit("chat:rename", { name: renameInput.value }, (res) => {
    if (!res?.ok) return showError(renameError, res?.error || "Не сменилось");
    myName = res.name;
    save("name", myName);
    syncMe();
    renameDialog.close();
    toast(`Теперь ${myName}`);
  });
});

presenceBtn?.addEventListener("click", () => {
  presenceList.innerHTML = "";
  for (const p of people) {
    const li = document.createElement("li");
    li.textContent = p.name;
    presenceList.append(li);
  }
  if (!people.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Пока никого";
    presenceList.append(li);
  }
  presenceDialog.showModal();
});
presenceClose?.addEventListener("click", () => presenceDialog.close());

notifyBtn?.addEventListener("click", async () => {
  await toggleNotify(myName);
  syncNotifyBtn(notifyBtn);
});

bindTap(sendBtn, sendMessage);
messageInput?.addEventListener("input", autoSize);
messageInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
replyCancel?.addEventListener("click", clearReply);
fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    toast("Загружаем фото…");
    pendingImageUrl = await uploadImage(file);
    pendingImage.hidden = false;
    pendingImage.textContent = "Фото приложено · можно отправить";
  } catch {
    toast("Не удалось загрузить фото");
  }
});

socket.on("connect", () => {
  createBusy = false;
  joinBusy = false;
  if (createBtn) createBtn.disabled = false;
  if (joinRoomBtn) joinRoomBtn.disabled = false;
  if (!myName) return;
  const pin = normalizePin(load("pin"));
  const adminToken = load("adminToken");
  socket.emit(
    "chat:join",
    {
      name: myName === "АДМИН" ? load("prevName") || myName : myName,
      pin: pin.length === 4 ? pin : undefined,
      clientId: clientId(),
      adminToken: adminToken || undefined,
      previousName: load("prevName") || undefined,
    },
    (res) => {
      if (!res?.ok) {
        leaveToGate(res?.error || "Сессия сброшена");
        return;
      }
      myName = res.name;
      if (res.admin) setAdminUi(true, res.name);
      else setAdminUi(false, res.name);
      if (roomCode) {
        enterRoom(roomCode, loadRoomKey(roomCode));
      }
    }
  );
});

socket.on("chat:presence", (state) => {
  people = state?.people || [];
  if (presenceBtn) presenceBtn.textContent = state?.count ? `онлайн ${state.count}` : "онлайн —";
});

socket.on("room:presence", (state) => {
  if (state?.code !== roomCode) return;
  syncRoomMeta(state);
});

socket.on("room:message", ({ code, message }) => {
  if (code !== roomCode || !message) return;
  appendMessage(message, true);
});

socket.on("room:react", ({ code, id, reactions }) => {
  if (code !== roomCode) return;
  const el = feed.querySelector(`[data-id="${CSS.escape(id)}"] [data-role="reactions"]`);
  if (el) renderReactions(el, reactions || {}, id);
});

socket.on("room:deleted", ({ code, ids }) => {
  if (code !== roomCode) return;
  for (const id of ids || []) {
    feed.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    knownIds.delete(id);
  }
});

socket.on("room:state", (state) => {
  if (state?.code !== roomCode) return;
  renderFeed(state.messages || [], state.pinned || []);
});

socket.on("room:flags", (flags) => {
  if (flags?.code !== roomCode) return;
  roomKeyed = Boolean(flags.keyed);
  roomClosed = Boolean(flags.closed);
  syncRoomMeta();
});

socket.on("room:gone", ({ code, reason }) => {
  if (code !== roomCode) return;
  roomCode = null;
  roomBar.hidden = true;
  feed.innerHTML = "";
  toast(reason === "closed" ? "Комната закрыта владельцем" : "Комната удалена");
  openHub();
});

socket.on("chat:author-renamed", ({ from, to }) => {
  feed.querySelectorAll(".msg").forEach((el) => {
    const nameEl = el.querySelector(".msg-name");
    if (nameEl && nameEl.textContent.startsWith(from)) {
      nameEl.textContent = nameEl.textContent.replace(from, to);
    }
  });
});

socket.on("chat:kicked", ({ reason }) => {
  leaveToGate(reason || "Сессия завершена");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const room = event.data?.roomCode;
    if (room && myName) enterRoom(room, loadRoomKey(room));
  });
}

syncViewport();
window.addEventListener("resize", () => {
  syncViewport();
  layoutHub(hubDialog);
});
window.visualViewport?.addEventListener("resize", () => {
  syncViewport();
  layoutHub(hubDialog);
});
window.visualViewport?.addEventListener("scroll", () => layoutHub(hubDialog));

const savedName = load("name");
const savedPin = load("pin");
if (savedName && nameInput) nameInput.value = savedName === "АДМИН" ? load("prevName") || "" : savedName;
if (savedPin && pinInput) pinInput.value = savedPin;
if ((savedName && savedPin) || load("adminToken")) {
  const boot = () => {
    if (myName) return;
    doJoin(savedName === "АДМИН" ? load("prevName") || savedName : savedName);
  };
  if (socket.connected) boot();
  else socket.once("connect", boot);
}
