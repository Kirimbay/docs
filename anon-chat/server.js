const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const { randomUUID, createHash } = require("crypto");
const helmet = require("helmet");
const sharp = require("sharp");
const webpush = require("web-push");

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const IMAGE_MAX_PX = Number(process.env.IMAGE_MAX_PX) || 1080;
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY) || 52;
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES) || 180 * 1024;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const ADMIN_TOKENS_PATH = path.join(DATA_DIR, "admin-tokens.json");
const ACCESS_PATH = path.join(DATA_DIR, "access.json");
const VAPID_PATH = path.join(DATA_DIR, "vapid.json");
const PUSH_SUBS_PATH = path.join(DATA_DIR, "push-subs.json");
const PUBLIC_CHAT_LABEL = "Сарафан ВПН";
/** Reserved pin for the former public feed — same rules as any other room. */
const PUBLIC_ROOM_CODE = "000000";
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const MAX_MESSAGES = 5000;
const MAX_NAME_LEN = 24;
const MAX_TEXT_LEN = 2000;
const MAX_ADMIN_TOKENS = 80;
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_DAYS) > 0
  ? Number(process.env.ROOM_IDLE_DAYS) * 24 * 60 * 60 * 1000
  : 30 * 24 * 60 * 60 * 1000;
const ROOM_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const NAMES = [
  "Барс",
  "Кит",
  "Лис",
  "Сокол",
  "Мох",
  "Огонь",
  "Туман",
  "Ручей",
  "Камень",
  "Ветер",
  "Клен",
  "Ясень",
  "Ива",
  "Роса",
  "Зефир",
  "Норд",
  "Юг",
  "Луч",
  "Тень",
  "Искра",
  "Пепел",
  "Гравий",
  "Буря",
  "Штиль",
  "Прибой",
  "Маяк",
  "Янтарь",
  "Оникс",
  "Яшма",
  "Лавр",
  "Кедр",
  "Пихта",
  "Рябина",
  "Осина",
  "Волна",
  "Скала",
  "Холм",
  "Луг",
  "Степь",
  "Тайга",
  "Полюс",
  "Экватор",
  "Комета",
  "Пульсар",
  "Квант",
  "Атом",
  "Неон",
  "Озон",
  "Радон",
  "Аргон",
  "Феникс",
  "Гриф",
  "Рысь",
  "Выдра",
  "Енот",
  "Бобр",
  "Лось",
  "Олень",
  "Косуля",
  "Стриж",
  "Дрозд",
  "Иволга",
  "Чиж",
  "Снегирь",
  "Клест",
  "Филин",
  "Коршун",
  "Ястреб",
  "Пустельга",
  "Марлин",
  "Скат",
  "Краб",
  "Устрица",
  "Коралл",
  "Жемчуг",
  "Сапфир",
  "Топаз",
  "Кварц",
  "Гранит",
  "Базальт",
  "Мрамор",
  "Мел",
  "Глина",
  "Песок",
  "Иней",
  "Снег",
  "Град",
  "Ливень",
  "Рассвет",
  "Закат",
  "Полдень",
  "Сумерки",
  "Зенит",
  "Горизонт",
  "Азимут",
  "Компас",
  "Парус",
  "Шлюп",
  "Бриг",
  "Фрегат",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadAdminTokens() {
  try {
    if (fs.existsSync(ADMIN_TOKENS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(ADMIN_TOKENS_PATH, "utf8"));
      const list = Array.isArray(raw?.tokens) ? raw.tokens : Array.isArray(raw) ? raw : [];
      return list.filter((t) => typeof t === "string" && t.length >= 20);
    }
  } catch (err) {
    console.error("Failed to load admin tokens:", err.message);
  }
  return [];
}

function saveAdminTokens(tokens) {
  const tmp = `${ADMIN_TOKENS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tokens }, null, 2));
  fs.renameSync(tmp, ADMIN_TOKENS_PATH);
}

/** @type {string[]} */
let adminTokens = loadAdminTokens();

function issueAdminToken() {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
  adminTokens.push(token);
  if (adminTokens.length > MAX_ADMIN_TOKENS) {
    adminTokens = adminTokens.slice(-MAX_ADMIN_TOKENS);
  }
  saveAdminTokens(adminTokens);
  return token;
}

function isValidAdminToken(token) {
  return typeof token === "string" && token.length >= 20 && adminTokens.includes(token);
}

function revokeAdminToken(token) {
  if (typeof token !== "string" || !token) return;
  const next = adminTokens.filter((t) => t !== token);
  if (next.length !== adminTokens.length) {
    adminTokens = next;
    saveAdminTokens(adminTokens);
  }
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      if (!Array.isArray(data.messages)) data.messages = [];
      if (!Array.isArray(data.pinnedIds)) data.pinnedIds = [];
      if (!data.rooms || typeof data.rooms !== "object") data.rooms = {};
      if (!data.accounts || typeof data.accounts !== "object") data.accounts = {};
      return data;
    }
  } catch (err) {
    console.error("Failed to load store:", err.message);
  }
  return { messages: [], pinnedIds: [], rooms: {}, accounts: {} };
}

function saveStore(store) {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function isPublicRoomCode(code) {
  return String(code || "") === PUBLIC_ROOM_CODE;
}

function ensurePublicRoom(data = store) {
  if (!data.rooms || typeof data.rooms !== "object") data.rooms = {};
  let room = data.rooms[PUBLIC_ROOM_CODE];
  if (!room || typeof room !== "object") {
    room = {
      code: PUBLIC_ROOM_CODE,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      createdBy: PUBLIC_CHAT_LABEL,
      label: PUBLIC_CHAT_LABEL,
      participants: [],
      messages: [],
      pinnedIds: [],
    };
    data.rooms[PUBLIC_ROOM_CODE] = room;
  }
  if (!Array.isArray(room.messages)) room.messages = [];
  if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
  if (!Array.isArray(room.participants)) room.participants = [];
  if (!room.label) room.label = PUBLIC_CHAT_LABEL;
  if (!room.code) room.code = PUBLIC_ROOM_CODE;
  return room;
}

/** One-time: move legacy top-level public feed into room 000000. */
function migratePublicFeedIntoRooms(data) {
  ensurePublicRoom(data);
  const room = data.rooms[PUBLIC_ROOM_CODE];
  const legacyMessages = Array.isArray(data.messages) ? data.messages : [];
  const legacyPins = Array.isArray(data.pinnedIds) ? data.pinnedIds : [];
  let changed = false;

  if (legacyMessages.length) {
    if (!room.messages.length) {
      room.messages = legacyMessages;
    } else {
      const have = new Set(room.messages.map((m) => m?.id).filter(Boolean));
      for (const msg of legacyMessages) {
        if (msg?.id && !have.has(msg.id)) {
          room.messages.push(msg);
          have.add(msg.id);
        }
      }
    }
    data.messages = [];
    changed = true;
  }

  if (legacyPins.length) {
    const have = new Set(room.pinnedIds);
    for (const id of legacyPins) {
      if (id && !have.has(id)) {
        room.pinnedIds.push(id);
        have.add(id);
      }
    }
    data.pinnedIds = [];
    changed = true;
  }

  // Ensure every room has pinnedIds (unified model).
  for (const r of Object.values(data.rooms)) {
    if (!r || typeof r !== "object") continue;
    if (!Array.isArray(r.pinnedIds)) {
      r.pinnedIds = [];
      changed = true;
    }
    if (!Array.isArray(r.messages)) {
      r.messages = [];
      changed = true;
    }
  }

  if (room.messages.length > MAX_MESSAGES) {
    room.messages = room.messages.slice(-MAX_MESSAGES);
    changed = true;
  }

  return changed;
}

let store = loadStore();
ensureAccounts();
if (migratePublicFeedIntoRooms(store)) {
  saveStore(store);
  console.log(`Migrated public feed into room ${PUBLIC_ROOM_CODE}`);
}

function loadAccess() {
  try {
    if (fs.existsSync(ACCESS_PATH)) {
      const data = JSON.parse(fs.readFileSync(ACCESS_PATH, "utf8"));
      if (!data || typeof data !== "object") return { bans: {}, roomsOnly: {} };
      if (!data.bans || typeof data.bans !== "object") data.bans = {};
      if (!data.roomsOnly || typeof data.roomsOnly !== "object") data.roomsOnly = {};
      return data;
    }
  } catch (err) {
    console.error("Failed to load access:", err.message);
  }
  return { bans: {}, roomsOnly: {} };
}

function saveAccess(next) {
  const tmp = `${ACCESS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, ACCESS_PATH);
}

let access = loadAccess();

function normalizeClientId(raw) {
  const id = String(raw || "").trim();
  return CLIENT_ID_RE.test(id) ? id : "";
}

function isBannedClient(clientId) {
  const id = normalizeClientId(clientId);
  return Boolean(id && access.bans[id]);
}

function isRoomsOnlyClient(clientId) {
  const id = normalizeClientId(clientId);
  return Boolean(id && access.roomsOnly[id]);
}

function rememberAccessName(bucket, clientId, name) {
  const id = normalizeClientId(clientId);
  if (!id || !access[bucket]?.[id]) return;
  const nick = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LEN) : "";
  if (!nick) return;
  const names = Array.isArray(access[bucket][id].names) ? access[bucket][id].names : [];
  if (!names.includes(nick)) {
    names.push(nick);
    access[bucket][id].names = names.slice(-12);
  }
}

function banClient(clientId, { name = "", reason = "", by = "АДМИН" } = {}) {
  const id = normalizeClientId(clientId);
  if (!id) return false;
  const prev = access.bans[id] || {};
  const names = Array.isArray(prev.names) ? [...prev.names] : [];
  if (name && !names.includes(name)) names.push(name);
  access.bans[id] = {
    at: new Date().toISOString(),
    by,
    reason: String(reason || "").trim().slice(0, 120),
    names: names.slice(-12),
  };
  // Ban supersedes rooms-only.
  if (access.roomsOnly[id]) delete access.roomsOnly[id];
  saveAccess(access);
  return true;
}

function unbanClient(clientId) {
  const id = normalizeClientId(clientId);
  if (!id || !access.bans[id]) return false;
  delete access.bans[id];
  saveAccess(access);
  return true;
}

function setRoomsOnlyClient(clientId, on, { name = "", label = "" } = {}) {
  const id = normalizeClientId(clientId);
  if (!id) return false;
  if (!on) {
    if (!access.roomsOnly[id]) return false;
    delete access.roomsOnly[id];
    saveAccess(access);
    return true;
  }
  if (access.bans[id]) return false;
  const prev = access.roomsOnly[id] || {};
  const names = Array.isArray(prev.names) ? [...prev.names] : [];
  if (name && !names.includes(name)) names.push(name);
  access.roomsOnly[id] = {
    at: new Date().toISOString(),
    label: String(label || prev.label || "").trim().slice(0, 40),
    names: names.slice(-12),
  };
  saveAccess(access);
  return true;
}

function findOnlineByClientId(clientId) {
  const id = normalizeClientId(clientId);
  if (!id) return [];
  const out = [];
  for (const [socketId, u] of online.entries()) {
    if (normalizeClientId(u.clientId) === id) out.push(socketId);
  }
  return out;
}

function kickBannedOrRestricted(socketId, reason) {
  evictSocketById(socketId, reason || "Доступ закрыт");
}

function notifyAccessUpdate(socketId) {
  const sock = io.sockets.sockets.get(socketId);
  const u = online.get(socketId);
  if (!sock || !u) return;
  sock.emit("access:update", {
    roomsOnly: isRoomsOnlyClient(u.clientId),
    publicLabel: PUBLIC_CHAT_LABEL,
    banned: false,
  });
}

function emptyPublicSnapshot() {
  return { messages: [], pinned: [] };
}

function emitRoomState(code) {
  const snap = roomSnapshot(code);
  if (!snap) return;
  io.to(roomChannel(code)).emit("dm:state", snap);
}

function emitRoomMessage(code, pub) {
  io.to(roomChannel(code)).emit("dm:message", pub);
}

function emitRoomMessageUpdate(code, pub) {
  io.to(roomChannel(code)).emit("dm:message-update", pub);
}

function emitRoomMessageRemoved(code, payload) {
  io.to(roomChannel(code)).emit("chat:message-removed", payload);
}

function loadOrCreateVapid() {
  try {
    if (fs.existsSync(VAPID_PATH)) {
      return JSON.parse(fs.readFileSync(VAPID_PATH, "utf8"));
    }
  } catch (err) {
    console.error("Failed to load VAPID keys:", err.message);
  }
  const keys = webpush.generateVAPIDKeys();
  const payload = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: process.env.VAPID_SUBJECT || "mailto:admin@chat.one.vele.uk",
  };
  try {
    fs.writeFileSync(VAPID_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("Failed to save VAPID keys:", err.message);
  }
  return payload;
}

const vapid = loadOrCreateVapid();
// Apple rejects BadJwtToken for subjects with fake TLDs like .local
if (
  !vapid.subject ||
  /@[^/]*\.local$/i.test(String(vapid.subject).replace(/^mailto:/i, "")) ||
  String(vapid.subject) === "mailto:admin@sarafan.local"
) {
  vapid.subject = process.env.VAPID_SUBJECT || "mailto:admin@chat.one.vele.uk";
  try {
    fs.writeFileSync(VAPID_PATH, JSON.stringify(vapid, null, 2));
  } catch (err) {
    console.error("Failed to update VAPID subject:", err.message);
  }
}
webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

function loadPushSubs() {
  try {
    if (fs.existsSync(PUSH_SUBS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PUSH_SUBS_PATH, "utf8"));
      return Array.isArray(raw) ? raw : [];
    }
  } catch (err) {
    console.error("Failed to load push subs:", err.message);
  }
  return [];
}

function savePushSubs(list) {
  const tmp = `${PUSH_SUBS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, PUSH_SUBS_PATH);
}

/** @type {{endpoint:string,keys:object,name:string,notifyPublic?:boolean,notifyDm?:boolean,updatedAt:string}[]} */
let pushSubs = loadPushSubs();

function normalizeNotifyFlag(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  return fallback;
}

function wantsPublicPush(sub) {
  return normalizeNotifyFlag(sub?.notifyPublic, true);
}

function wantsDmPush(sub) {
  return normalizeNotifyFlag(sub?.notifyDm, true);
}

function upsertPushSub(subscription, name, prefs = {}) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { ok: false, error: "Некорректная подписка" };
  }
  const nick = sanitizeName(name) || "";
  const now = new Date().toISOString();
  const idx = pushSubs.findIndex((s) => s.endpoint === subscription.endpoint);
  const prev = idx >= 0 ? pushSubs[idx] : null;
  const notifyPublic =
    prefs.notifyPublic === undefined
      ? normalizeNotifyFlag(prev?.notifyPublic, true)
      : normalizeNotifyFlag(prefs.notifyPublic, true);
  const notifyDm =
    prefs.notifyDm === undefined
      ? normalizeNotifyFlag(prev?.notifyDm, true)
      : normalizeNotifyFlag(prefs.notifyDm, true);
  const row = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    name: nick,
    notifyPublic,
    notifyDm,
    updatedAt: now,
  };
  if (idx >= 0) pushSubs[idx] = row;
  else pushSubs.push(row);
  if (pushSubs.length > 2000) {
    pushSubs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    pushSubs = pushSubs.slice(0, 2000);
  }
  savePushSubs(pushSubs);
  return { ok: true, notifyPublic, notifyDm };
}

function removePushSub(endpoint) {
  const before = pushSubs.length;
  pushSubs = pushSubs.filter((s) => s.endpoint !== endpoint);
  if (pushSubs.length !== before) savePushSubs(pushSubs);
}

function renamePushSubs(oldName, newName) {
  const oldKey = nameKey(oldName);
  const next = sanitizeName(newName);
  if (!oldKey || !next) return;
  let changed = false;
  for (const sub of pushSubs) {
    if (nameKey(sub.name) === oldKey) {
      sub.name = next;
      sub.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) savePushSubs(pushSubs);
}

async function sendWebPush(sub, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: sub.keys,
      },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: "high" }
    );
    return true;
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) removePushSub(sub.endpoint);
    else console.error("webpush error:", code || err.message);
    return false;
  }
}

async function pushToName(name, payload, kind = "any") {
  if (!name) return 0;
  const key = nameKey(name);
  const targets = pushSubs.filter((s) => {
    if (nameKey(s.name) !== key) return false;
    if (kind === "dm") return wantsDmPush(s);
    if (kind === "public") return wantsPublicPush(s);
    return true;
  });
  const results = await Promise.all(targets.map((s) => sendWebPush(s, payload)));
  return results.filter(Boolean).length;
}

async function pushToAll(payload, kind = "any") {
  const targets = pushSubs.filter((s) => {
    if (kind === "dm") return wantsDmPush(s);
    if (kind === "public") return wantsPublicPush(s);
    return true;
  });
  const results = await Promise.all(targets.map((s) => sendWebPush(s, payload)));
  return results.filter(Boolean).length;
}

function previewPushBody(msg) {
  const text = (msg.text || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 120);
  if (msg.imageUrl) return "📷 Фото";
  return "Новое сообщение";
}

function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

const ADMIN_DISPLAY_NAME = "АДМИН";

function isReservedAdminName(name) {
  if (typeof name !== "string") return false;
  return name.replace(/\s+/g, "").toLocaleUpperCase("ru-RU") === ADMIN_DISPLAY_NAME;
}

function isAdminName(name) {
  return isReservedAdminName(name);
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
  if (!name) return null;
  return name;
}

function nameKey(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function findSocketIdsWithName(name, exceptSocketId = null) {
  const key = nameKey(name);
  if (!key) return [];
  const ids = [];
  for (const [id, u] of online) {
    if (exceptSocketId && id === exceptSocketId) continue;
    if (nameKey(u.name) === key) ids.push(id);
  }
  return ids;
}

function isNameTaken(name, exceptSocketId = null, exceptAccountId = null) {
  if (findSocketIdsWithName(name, exceptSocketId).length > 0) return true;
  return isAccountNickTaken(name, exceptAccountId);
}

function rewriteStoredAuthorName(oldName, newName) {
  const oldKey = nameKey(oldName);
  const nextName = sanitizeName(newName);
  if (!oldKey || !nextName || oldKey === nameKey(nextName)) return 0;

  let changed = 0;

  const rewriteList = (list) => {
    if (!Array.isArray(list)) return;
    for (const msg of list) {
      if (!msg || typeof msg !== "object") continue;
      if (nameKey(msg.name) === oldKey) {
        msg.name = nextName;
        changed += 1;
      }
      if (msg.reply && typeof msg.reply === "object" && nameKey(msg.reply.name) === oldKey) {
        msg.reply.name = nextName;
        changed += 1;
      }
      if (msg.reactions && typeof msg.reactions === "object") {
        let reacted = false;
        for (const emoji of Object.keys(msg.reactions)) {
          const names = msg.reactions[emoji];
          if (!Array.isArray(names)) continue;
          let touch = false;
          const mapped = names.map((n) => {
            if (nameKey(n) === oldKey) {
              touch = true;
              return nextName;
            }
            return n;
          });
          if (touch) {
            reacted = true;
            const uniq = [...new Set(mapped.filter((n) => typeof n === "string" && n.trim()))];
            if (uniq.length) msg.reactions[emoji] = uniq;
            else delete msg.reactions[emoji];
          }
        }
        if (reacted) {
          msg.reactions = normalizeReactions(msg.reactions);
          changed += 1;
        }
      }
    }
  };

  rewriteList(store.messages); // legacy no-op after migration
  ensureRooms();
  for (const room of Object.values(store.rooms || {})) {
    if (!room || typeof room !== "object") continue;
    rewriteList(room.messages);
    if (Array.isArray(room.participants)) {
      let touched = false;
      room.participants = room.participants.map((n) => {
        if (nameKey(n) !== oldKey) return n;
        touched = true;
        return nextName;
      });
      if (touched) {
        room.participants = [...new Set(room.participants.filter(Boolean))];
        changed += 1;
      }
    }
    if (nameKey(room.createdBy) === oldKey) {
      room.createdBy = nextName;
      changed += 1;
    }
  }
  return changed;
}

function uniqueRandomName(extraExclude = []) {
  const taken = new Set([...online.values()].map((u) => nameKey(u.name)));
  ensureAccounts();
  for (const acc of Object.values(store.accounts || {})) {
    if (acc?.nick) taken.add(nameKey(acc.nick));
  }
  for (const n of extraExclude) {
    const key = nameKey(n);
    if (key) taken.add(key);
  }
  const free = NAMES.filter((n) => !taken.has(nameKey(n)));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let n = 0; n < 80; n += 1) {
    const base = NAMES[Math.floor(Math.random() * NAMES.length)];
    const candidate = `${base}${Math.floor(10 + Math.random() * 90)}`;
    if (!taken.has(nameKey(candidate))) return candidate.slice(0, MAX_NAME_LEN);
  }
  return `Гость${String(Date.now()).slice(-4)}`;
}

function evictSocketById(id, reason) {
  const other = io.sockets.sockets.get(id);
  if (other) {
    try {
      other.emit("chat:kicked", { reason: reason || "Сессия закрыта" });
    } catch {
      /* ignore */
    }
    leaveDmRoom(other);
    online.delete(id);
    other.disconnect(true);
  } else {
    online.delete(id);
  }
}

/** One live connection per name: new join/reconnect replaces older tabs. */
function claimName(name, socketId) {
  for (const id of findSocketIdsWithName(name, socketId)) {
    evictSocketById(id, "Это имя открыто в другой вкладке — оставлена одна сессия");
  }
}

function sanitizeText(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_TEXT_LEN);
}

const REACTION_EMOJIS = ["😊", "❤️", "😢", "💩", "🔥"];

function normalizeReactions(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const emoji of REACTION_EMOJIS) {
    const list = Array.isArray(raw[emoji])
      ? raw[emoji].filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim().slice(0, MAX_NAME_LEN))
      : [];
    if (list.length) out[emoji] = [...new Set(list)];
  }
  return out;
}

function serializeMessage(msg, pinnedIds = []) {
  const pins = Array.isArray(pinnedIds) ? pinnedIds : [];
  return {
    id: msg.id,
    name: msg.name,
    text: msg.text || "",
    imageUrl: msg.imageUrl || null,
    createdAt: msg.createdAt,
    pinned: pins.includes(msg.id),
    admin: Boolean(msg.admin),
    roomAdmin: Boolean(msg.roomAdmin),
    reply: msg.reply
      ? {
          id: msg.reply.id,
          name: msg.reply.name,
          text: msg.reply.text || "",
        }
      : null,
    reactions: normalizeReactions(msg.reactions),
  };
}

/** @deprecated legacy alias — everything is a room now */
function publicMessage(msg) {
  ensurePublicRoom();
  return serializeMessage(msg, store.rooms[PUBLIC_ROOM_CODE]?.pinnedIds || []);
}

function publicRoomMessage(msg, code = "") {
  ensureRooms();
  const room = code ? store.rooms[code] : null;
  return serializeMessage(msg, room?.pinnedIds || []);
}

function snapshot() {
  // Compatibility: empty until the client joins a room by pin.
  return emptyPublicSnapshot();
}

const ROOM_CODE_ALPHABET = "0123456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_KEY_LENGTH = 4;
const MAX_ROOM_CODES = 10 ** ROOM_CODE_LENGTH; // 1_000_000: 000000–999999
const MAX_ROOM_MESSAGES = MAX_MESSAGES;
const MAX_ROOM_MEMBERS = 5000;

function ensureRooms() {
  if (!store.rooms || typeof store.rooms !== "object") store.rooms = {};
  ensurePublicRoom();
}

function roomCodeCount() {
  ensureRooms();
  return Object.keys(store.rooms).length;
}

/** @returns {string|null} unique 6-digit pin, or null if the pool is exhausted */
function generateRoomCode() {
  ensureRooms();
  // Public room always occupies 000000.
  if (roomCodeCount() >= MAX_ROOM_CODES) return null;

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const code = String(Math.floor(Math.random() * MAX_ROOM_CODES)).padStart(ROOM_CODE_LENGTH, "0");
    if (code === PUBLIC_ROOM_CODE) continue;
    if (!store.rooms[code]) return code;
  }

  // Near-full pool: scan from a random offset until a free code is found.
  const start = Math.floor(Math.random() * MAX_ROOM_CODES);
  for (let i = 0; i < MAX_ROOM_CODES; i += 1) {
    const code = String((start + i) % MAX_ROOM_CODES).padStart(ROOM_CODE_LENGTH, "0");
    if (code === PUBLIC_ROOM_CODE) continue;
    if (!store.rooms[code]) return code;
  }
  return null;
}

function normalizeRoomCode(raw) {
  // 6-digit room number. Pure short digits pad: 75 → 000075. Reject alphanumeric.
  const s = String(raw ?? "").trim();
  if (/^\d{6}$/.test(s)) return s;
  if (/^\d{1,5}$/.test(s)) return s.padStart(ROOM_CODE_LENGTH, "0");
  const compact = s.replace(/\s+/g, "");
  if (/^\d{1,6}$/.test(compact)) return compact.padStart(ROOM_CODE_LENGTH, "0");
  return null;
}

/** Exactly 4 digits — room key (тёрка). Never pad. */
function normalizeRoomKey(raw) {
  const key = String(raw ?? "").replace(/\D/g, "");
  return key.length === ROOM_KEY_LENGTH ? key : "";
}

function hashRoomKey(key) {
  const k = normalizeRoomKey(key);
  if (!k) return "";
  return createHash("sha256").update(`sarafan-room-key:v1:${k}`).digest("hex");
}

/** Account PIN uses the same 4-digit sha256 style as room keys. */
function hashAccountPin(pin) {
  return hashRoomKey(pin);
}

function ensureAccounts() {
  if (!store.accounts || typeof store.accounts !== "object") store.accounts = {};
  return store.accounts;
}

function findAccountByNick(nick) {
  ensureAccounts();
  const key = nameKey(nick);
  if (!key) return null;
  for (const acc of Object.values(store.accounts)) {
    if (acc && nameKey(acc.nick) === key) return acc;
  }
  return null;
}

function isAccountNickTaken(nick, exceptAccountId = null) {
  const found = findAccountByNick(nick);
  if (!found) return false;
  if (exceptAccountId && found.id === exceptAccountId) return false;
  return true;
}

function createAccount(nick, pin) {
  ensureAccounts();
  const pinHash = hashAccountPin(pin);
  if (!pinHash) return null;
  const id = randomUUID();
  const account = {
    id,
    nick: sanitizeName(nick),
    pinHash,
    createdAt: new Date().toISOString(),
  };
  store.accounts[id] = account;
  return account;
}

function ownedRoomsForAccount(accountId) {
  if (!accountId) return [];
  ensureRooms();
  const list = [];
  for (const room of Object.values(store.rooms || {})) {
    if (!room || typeof room !== "object") continue;
    if (isPublicRoomCode(room.code)) continue;
    if (room.ownerAccountId !== accountId) continue;
    list.push({
      code: room.code,
      ...roomPublicFlags(room),
    });
  }
  list.sort((a, b) => {
    const ra = store.rooms[a.code];
    const rb = store.rooms[b.code];
    const ta = Date.parse(String(ra?.lastActiveAt || ra?.createdAt || "")) || 0;
    const tb = Date.parse(String(rb?.lastActiveAt || rb?.createdAt || "")) || 0;
    return tb - ta;
  });
  return list.slice(0, 50);
}

/** Migrate legacy rooms owned by this clientId onto the account (once). */
function claimRoomsForAccount(accountId, clientId) {
  if (!accountId || !clientId) return 0;
  ensureRooms();
  let claimed = 0;
  for (const room of Object.values(store.rooms || {})) {
    if (!room || typeof room !== "object") continue;
    if (isPublicRoomCode(room.code)) continue;
    if (room.ownerAccountId) continue;
    if (room.ownerClientId && room.ownerClientId === clientId) {
      room.ownerAccountId = accountId;
      claimed += 1;
    }
  }
  return claimed;
}

function getSocketAccountId(socket) {
  if (!socket) return "";
  return (
    socket.data?.accountId ||
    online.get(socket.id)?.accountId ||
    ""
  );
}

/** Confirm room owner action: account pin for account-owned rooms, else admin key. */
function verifyOwnerConfirmKey(socket, room, key) {
  if (isSuperAdminSocket(socket)) return true;
  const normalized = normalizeRoomKey(key);
  if (!normalized || !room) return false;
  const digest = hashAccountPin(normalized);
  if (room.ownerAccountId) {
    ensureAccounts();
    const acc = store.accounts[room.ownerAccountId];
    return Boolean(acc?.pinHash && digest === acc.pinHash);
  }
  const adminHash = roomAdminKeyHash(room);
  return Boolean(adminHash && digest === adminHash);
}

function roomAccessMode(room) {
  return room && room.access === "keyed" ? "keyed" : "open";
}

function isRoomClosed(room) {
  return Boolean(room && room.closed);
}

function isSuperAdminSocket(socket) {
  return Boolean(socket?.data?.isAdmin);
}

/** Global super-admin or unlocked room-admin for the current room. */
function canModerateRoom(socket) {
  if (isSuperAdminSocket(socket)) return true;
  const code = socket?.data?.roomCode;
  return Boolean(code && socket.data.roomAdmin && socket.data.roomAdminCode === code);
}

function clearRoomAdmin(socket) {
  if (!socket) return;
  socket.data.roomAdmin = false;
  socket.data.roomAdminCode = null;
}

function roomPublicFlags(room) {
  return {
    access: roomAccessMode(room),
    closed: isRoomClosed(room),
    keyed: roomAccessMode(room) === "keyed",
    hasKey: Boolean(roomAdminKeyHash(room) || roomJoinKeyHash(room)),
  };
}

function roomAdminKeyHash(room) {
  if (!room) return "";
  return room.adminKeyHash || room.keyHash || "";
}

function roomJoinKeyHash(room) {
  if (!room || roomAccessMode(room) !== "keyed") return "";
  return room.keyHash || room.joinKeyHash || room.adminKeyHash || "";
}

function isRoomOwner(socket, room) {
  if (!socket || !room) return false;
  if (isSuperAdminSocket(socket)) return true;
  const accountId = getSocketAccountId(socket);
  if (room.ownerAccountId && accountId && room.ownerAccountId === accountId) return true;
  const clientId = normalizeClientId(
    online.get(socket.id)?.clientId || socket.data.clientId
  );
  if (room.ownerClientId && clientId && room.ownerClientId === clientId) return true;
  // Legacy rooms without any owner binding: key alone is enough later.
  return !room.ownerClientId && !room.ownerAccountId;
}

function roomChannel(code) {
  return `dm:${code}`;
}

function isSocketAdmin(socketOrUser) {
  if (!socketOrUser) return false;
  if (socketOrUser.isAdmin || socketOrUser.data?.isAdmin) return true;
  return false;
}

function roomSocketIds(code) {
  const set = io.sockets.adapter.rooms.get(roomChannel(code));
  return set ? [...set] : [];
}

/** Visible members only — admins are ghosts and do not take a seat. */
function roomOnlineCount(code) {
  let n = 0;
  for (const id of roomSocketIds(code)) {
    const sock = io.sockets.sockets.get(id);
    const u = online.get(id);
    if (!u) continue;
    if (isSocketAdmin(sock) || isSocketAdmin(u) || isAdminName(u.name)) continue;
    n += 1;
  }
  return n;
}

/** Any connection still inside (incl. admin watchers) — used to skip idle prune. */
function roomHasOccupant(code) {
  return roomSocketIds(code).length > 0;
}

function roomMemberNames(code) {
  const names = [];
  for (const u of online.values()) {
    if (u.roomCode !== code || !u.name) continue;
    if (u.isAdmin || isAdminName(u.name)) continue;
    names.push(u.name);
  }
  return names;
}

function roomSnapshot(code) {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return null;
  if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
  const pinned = room.pinnedIds
    .map((id) => (room.messages || []).find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => publicRoomMessage(m, code));
  return {
    code,
    label: isPublicRoomCode(code) ? PUBLIC_CHAT_LABEL : room.label || "",
    messages: (room.messages || []).map((m) => publicRoomMessage(m, code)),
    pinned,
  };
}

function roomPeerFor(code, exceptName = "") {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return "";
  const except = String(exceptName || "").trim();
  for (const u of online.values()) {
    if (u.roomCode !== code || !u.name || u.name === except) continue;
    if (u.isAdmin || isAdminName(u.name)) continue;
    return u.name;
  }
  const msgs = Array.isArray(room.messages) ? room.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const name = msgs[i]?.name;
    if (!name || name === except || isAdminName(name) || msgs[i]?.admin) continue;
    return name;
  }
  if (room.createdBy && room.createdBy !== except && !isAdminName(room.createdBy)) {
    return room.createdBy;
  }
  return "";
}

function ensureRoomParticipants(room) {
  if (!room || typeof room !== "object") return [];
  if (!Array.isArray(room.participants)) room.participants = [];
  return room.participants;
}

function rememberRoomParticipant(code, name) {
  ensureRooms();
  const room = store.rooms[code];
  const nick = sanitizeName(name);
  if (!room || !nick) return;
  const list = ensureRoomParticipants(room);
  const key = nameKey(nick);
  const idx = list.findIndex((n) => nameKey(n) === key);
  if (idx >= 0) list[idx] = nick;
  else list.push(nick);
  if (list.length > MAX_ROOM_MEMBERS * 2) {
    room.participants = list.slice(-MAX_ROOM_MEMBERS);
  }
}

function roomPushNames(code, exceptName = "") {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return [];
  const exceptKey = nameKey(exceptName);
  const names = new Map();
  for (const n of ensureRoomParticipants(room)) {
    if (isAdminName(n)) continue;
    const key = nameKey(n);
    if (key && key !== exceptKey) names.set(key, n);
  }
  for (const u of online.values()) {
    if (u.roomCode !== code || !u.name) continue;
    if (u.isAdmin || isAdminName(u.name)) continue;
    const key = nameKey(u.name);
    if (key && key !== exceptKey) names.set(key, u.name);
  }
  return [...names.values()];
}

function roomParticipantNames(code) {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return [];
  const map = new Map();
  for (const n of ensureRoomParticipants(room)) {
    if (isAdminName(n)) continue;
    const key = nameKey(n);
    if (key) map.set(key, n);
  }
  for (const m of Array.isArray(room.messages) ? room.messages : []) {
    if (isAdminName(m?.name) || m?.admin) continue;
    const key = nameKey(m?.name);
    if (key) map.set(key, m.name);
  }
  if (room.createdBy && !isAdminName(room.createdBy)) {
    const createdKey = nameKey(room.createdBy);
    if (createdKey) map.set(createdKey, room.createdBy);
  }
  for (const u of online.values()) {
    if (u.roomCode !== code || !u.name) continue;
    if (u.isAdmin || isAdminName(u.name)) continue;
    const key = nameKey(u.name);
    if (key) map.set(key, u.name);
  }
  const onlineKeys = new Set(
    roomMemberNames(code)
      .map((n) => nameKey(n))
      .filter(Boolean)
  );
  return [...map.values()].sort((a, b) => {
    const ao = onlineKeys.has(nameKey(a)) ? 0 : 1;
    const bo = onlineKeys.has(nameKey(b)) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(a).localeCompare(String(b), "ru-RU");
  });
}

function unreadSince(messages, sinceId) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return 0;
  if (typeof sinceId !== "string" || !sinceId) return list.length;
  const idx = list.findIndex((m) => m && m.id === sinceId);
  if (idx < 0) return list.length;
  return Math.max(0, list.length - idx - 1);
}

function roomListMeta(code, exceptName = "", sinceId = "") {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) {
    return {
      code,
      exists: false,
      peer: "",
      names: [],
      messageCount: 0,
      unread: 0,
      lastMessageId: "",
      onlineCount: 0,
      maxMembers: MAX_ROOM_MEMBERS,
    };
  }
  const names = roomParticipantNames(code);
  const exceptKey = nameKey(exceptName);
  const others = names.filter((n) => nameKey(n) !== exceptKey);
  let peer = "";
  if (others.length === 1) peer = others[0];
  else if (others.length > 1) peer = `${others[0]} +${others.length - 1}`;
  else if (names.length) peer = names[0];
  const messages = Array.isArray(room.messages) ? room.messages : [];
  const lastMessageId = messages.length ? String(messages[messages.length - 1]?.id || "") : "";
  return {
    code,
    exists: true,
    label: isPublicRoomCode(code) ? PUBLIC_CHAT_LABEL : room.label || "",
    public: isPublicRoomCode(code),
    access: roomAccessMode(room),
    closed: isRoomClosed(room),
    keyed: roomAccessMode(room) === "keyed",
    peer: isPublicRoomCode(code) ? PUBLIC_CHAT_LABEL : peer,
    names,
    messageCount: messages.length,
    unread: unreadSince(messages, sinceId),
    lastMessageId,
    onlineCount: roomOnlineCount(code),
    maxMembers: MAX_ROOM_MEMBERS,
  };
}

function roomLastActiveMs(room) {
  if (!room || typeof room !== "object") return 0;
  const candidates = [room.lastActiveAt, room.createdAt];
  const msgs = Array.isArray(room.messages) ? room.messages : [];
  if (msgs.length) candidates.push(msgs[msgs.length - 1]?.createdAt);
  let best = 0;
  for (const raw of candidates) {
    const t = Date.parse(String(raw || ""));
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

function touchRoom(code, { persist = false } = {}) {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return;
  room.lastActiveAt = new Date().toISOString();
  if (persist) saveStore(store);
}

function unlinkRoomImages(room) {
  const msgs = Array.isArray(room?.messages) ? room.messages : [];
  for (const msg of msgs) {
    if (!msg?.imageUrl) continue;
    const file = path.join(UPLOAD_DIR, path.basename(msg.imageUrl));
    fs.promises.unlink(file).catch(() => {});
  }
}

function kickSocketsFromRoom(code) {
  const set = io.sockets.adapter.rooms.get(roomChannel(code));
  if (!set) return;
  for (const socketId of [...set]) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    leaveDmRoom(sock);
    sock.emit("dm:room-gone", { code, reason: "inactive" });
    sock.emit("chat:state", emptyPublicSnapshot());
  }
}

function pruneInactiveRooms({ persist = true } = {}) {
  ensureRooms();
  const now = Date.now();
  const removed = [];
  for (const [code, room] of Object.entries(store.rooms)) {
    if (isPublicRoomCode(code)) continue;
    const last = roomLastActiveMs(room);
    // Empty brand-new rooms without timestamps: treat createdAt/now missing as stale only if no activity clue.
    const ageBase = last || Date.parse(String(room?.createdAt || "")) || 0;
    if (!ageBase) continue;
    if (now - ageBase < ROOM_IDLE_MS) continue;
    // Do not delete a room while someone is currently inside (incl. admin watchers).
    if (roomHasOccupant(code)) {
      touchRoom(code);
      continue;
    }
    unlinkRoomImages(room);
    delete store.rooms[code];
    removed.push(code);
  }
  if (removed.length && persist) saveStore(store);
  return removed;
}

function roomModeratorRoles(code) {
  /** @type {{ name: string, role: "super" | "admin" }[]} */
  const out = [];
  const seen = new Set();
  for (const id of roomSocketIds(code)) {
    const sock = io.sockets.sockets.get(id);
    const u = online.get(id);
    if (!sock || !u?.name) continue;
    let role = null;
    if (sock.data.isAdmin || u.isAdmin) role = "super";
    else if (sock.data.roomAdmin && sock.data.roomAdminCode === code) role = "admin";
    if (!role) continue;
    const key = `${nameKey(u.name)}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: u.name, role });
  }
  return out;
}

function emitDmPresence(code) {
  io.to(roomChannel(code)).emit("dm:presence", {
    code,
    count: roomOnlineCount(code),
    names: roomMemberNames(code),
    participants: roomParticipantNames(code),
    moderators: roomModeratorRoles(code),
    maxMembers: MAX_ROOM_MEMBERS,
  });
}

function presencePayload(forSocket = null) {
  const asAdmin = Boolean(forSocket?.data?.isAdmin);
  const people = [...online.entries()].map(([id, u]) => {
    const row = { id, name: u.name };
    if (asAdmin) {
      row.clientId = normalizeClientId(u.clientId) || "";
      row.roomsOnly = isRoomsOnlyClient(u.clientId);
    }
    return row;
  });
  return {
    count: people.length,
    people,
    names: people.map((p) => p.name),
  };
}

function emitChatPresence() {
  for (const sock of io.sockets.sockets.values()) {
    sock.emit("chat:presence", presencePayload(sock));
  }
}

function leaveDmRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) {
    clearRoomAdmin(socket);
    return;
  }
  socket.leave(roomChannel(code));
  socket.data.roomCode = null;
  socket.data.roomGhost = false;
  clearRoomAdmin(socket);
  const user = online.get(socket.id);
  if (user) user.roomCode = null;
  emitDmPresence(code);
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Только изображения"));
    }
    cb(null, true);
  },
});

async function compressImageBuffer(buffer) {
  async function encode(quality) {
    const base = sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: IMAGE_MAX_PX,
        height: IMAGE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      });

    try {
      const webp = await base
        .clone()
        .webp({ quality, effort: 5, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      if (webp.info.size > 0) {
        return { buffer: webp.data, ext: ".webp", mime: "image/webp" };
      }
    } catch (err) {
      console.warn("webp compress failed, falling back to jpeg:", err.message);
    }

    const jpeg = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: IMAGE_MAX_PX,
        height: IMAGE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: Math.min(78, quality + 10), mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: jpeg.data, ext: ".jpg", mime: "image/jpeg" };
  }

  let quality = IMAGE_QUALITY;
  let result = await encode(quality);
  // Re-encode smaller if still over the soft byte budget.
  while (result.buffer.length > IMAGE_MAX_BYTES && quality > 28) {
    quality = Math.max(28, quality - 10);
    result = await encode(quality);
  }
  return result;
}

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "32kb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1d" }));
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/sw\.js$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Service-Worker-Allowed", "/");
        return;
      }
      if (/\.(html|css|js|webmanifest)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.post("/api/push-subscribe", (req, res) => {
  const subscription = req.body?.subscription;
  const name = req.body?.name;
  const result = upsertPushSub(subscription, name, {
    notifyPublic: req.body?.notifyPublic,
    notifyDm: req.body?.notifyDm,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json({
    ok: true,
    notifyPublic: result.notifyPublic,
    notifyDm: result.notifyDm,
  });
});

app.post("/api/push-unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === "string" && endpoint) removePushSub(endpoint);
  res.json({ ok: true });
});

app.get("/api/name-pool", (_req, res) => {
  res.json({ names: NAMES.slice() });
});

app.get("/api/random-name", (req, res) => {
  const raw = req.query?.exclude;
  const exclude = [];
  if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(",")) {
      const n = sanitizeName(part);
      if (n) exclude.push(n);
    }
  } else if (Array.isArray(raw)) {
    for (const part of raw) {
      const n = sanitizeName(String(part || ""));
      if (n) exclude.push(n);
    }
  }
  res.json({ name: uniqueRandomName(exclude) });
});

app.post("/api/upload", (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `Файл больше ${MAX_UPLOAD_MB} МБ`
          : err.message || "Ошибка загрузки";
      return res.status(400).json({ error: message });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: "Файл не получен" });
    }
    try {
      const compressed = await compressImageBuffer(req.file.buffer);
      // Keep original only if somehow much smaller (rare for phone photos).
      let outBuf = compressed.buffer;
      let ext = compressed.ext;
      if (req.file.buffer.length + 2048 < outBuf.length) {
        const origExt = path.extname(req.file.originalname || "").toLowerCase();
        const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(origExt)
          ? origExt
          : ".jpg";
        outBuf = req.file.buffer;
        ext = safeExt === ".jpeg" ? ".jpg" : safeExt;
      }
      const filename = `${Date.now()}-${randomUUID()}${ext}`;
      const dest = path.join(UPLOAD_DIR, filename);
      await fs.promises.writeFile(dest, outBuf);
      res.json({
        imageUrl: `/uploads/${filename}`,
        bytes: outBuf.length,
        originalBytes: req.file.buffer.length,
      });
    } catch (compressErr) {
      console.error("compress failed:", compressErr.message);
      res.status(400).json({ error: "Не удалось обработать изображение" });
    }
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
});

const online = new Map();

io.on("connection", (socket) => {
  socket.emit("chat:state", snapshot());

  socket.on("chat:join", (payload = {}, ack) => {
    const adminToken =
      typeof payload.adminToken === "string" ? payload.adminToken.trim() : "";
    const asAdmin = Boolean(adminToken && isValidAdminToken(adminToken));
    const clientId = normalizeClientId(payload.clientId);
    if (!asAdmin && clientId && isBannedClient(clientId)) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Доступ закрыт администратором" });
      }
      socket.emit("chat:kicked", { reason: "Доступ закрыт администратором" });
      socket.disconnect(true);
      return;
    }
    let custom = sanitizeName(payload.name);
    if (custom && isReservedAdminName(custom) && !asAdmin) {
      custom = null;
    }
    const prevFromClient = sanitizeName(payload.previousName);
    const previousName =
      prevFromClient && !isReservedAdminName(prevFromClient) ? prevFromClient : null;

    let name;
    let account = null;
    let accountId = "";
    let createdAccount = false;

    if (asAdmin) {
      name = ADMIN_DISPLAY_NAME;
    } else {
      if (!custom) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Введите имя" });
        }
        return;
      }
      const pin = normalizeRoomKey(payload.pin);
      if (!pin) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Нужен пин из 4 цифр" });
        }
        return;
      }
      ensureAccounts();
      const existing = findAccountByNick(custom);
      if (existing) {
        if (hashAccountPin(pin) !== existing.pinHash) {
          if (typeof ack === "function") {
            ack({ ok: false, error: "Неверный пин" });
          }
          return;
        }
        account = existing;
        // Keep stored nick casing from account.
        name = account.nick || custom;
      } else {
        account = createAccount(custom, pin);
        if (!account) {
          if (typeof ack === "function") {
            ack({ ok: false, error: "Нужен пин из 4 цифр" });
          }
          return;
        }
        createdAccount = true;
        name = account.nick;
      }
      accountId = account.id;
    }

    // One connection per nick: replace older tab/device with the same name.
    claimName(name, socket.id);
    leaveDmRoom(socket);
    const roomsOnly = !asAdmin && isRoomsOnlyClient(clientId);
    let ownedRooms = [];
    if (accountId) {
      const claimed = clientId ? claimRoomsForAccount(accountId, clientId) : 0;
      ownedRooms = ownedRoomsForAccount(accountId);
      if (createdAccount || claimed) saveStore(store);
    }
    online.set(socket.id, {
      name,
      isAdmin: asAdmin,
      roomCode: null,
      previousName: asAdmin ? previousName : null,
      clientId: clientId || "",
      accountId: accountId || "",
    });
    socket.data.name = name;
    socket.data.isAdmin = asAdmin;
    socket.data.roomCode = null;
    socket.data.previousName = asAdmin ? previousName : null;
    socket.data.clientId = clientId || "";
    socket.data.accountId = accountId || "";
    if (clientId) {
      rememberAccessName("roomsOnly", clientId, name);
      rememberAccessName("bans", clientId, name);
    }
    emitChatPresence();
    // Messages live in rooms — client must join by pin (incl. 000000).
    socket.emit("chat:state", emptyPublicSnapshot());
    if (typeof ack === "function") {
      ack({
        ok: true,
        name,
        admin: asAdmin,
        previousName: asAdmin ? previousName : null,
        roomsOnly,
        publicLabel: PUBLIC_CHAT_LABEL,
        publicRoomCode: PUBLIC_ROOM_CODE,
        accountId: accountId || undefined,
        ownedRooms: asAdmin ? undefined : ownedRooms,
      });
    }
  });

  socket.on("chat:rename", (payload = {}, ack) => {
    const name = sanitizeName(payload.name);
    if (!name) {
      if (typeof ack === "function") ack({ ok: false, error: "Пустое имя" });
      return;
    }
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    if (user.isAdmin || socket.data.isAdmin) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "В режиме админа имя нельзя сменить — сначала выйдите" });
      }
      return;
    }
    const accountId = getSocketAccountId(socket);
    ensureAccounts();
    const account = accountId ? store.accounts[accountId] : null;
    if (!account) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Сначала войдите с ником и пином" });
      }
      return;
    }
    if (isReservedAdminName(name)) {
      if (typeof ack === "function") ack({ ok: false, error: "Это имя зарезервировано" });
      return;
    }
    if (isNameTaken(name, socket.id, accountId)) {
      if (typeof ack === "function") ack({ ok: false, error: "Имя уже занято — выберите другое" });
      return;
    }
    const previousName = user.name;
    if (nameKey(previousName) === nameKey(name)) {
      if (typeof ack === "function") ack({ ok: true, name: previousName, from: previousName });
      return;
    }
    account.nick = name;
    user.name = name;
    socket.data.name = name;
    const rewritten = rewriteStoredAuthorName(previousName, name);
    saveStore(store);
    renamePushSubs(previousName, name);
    emitChatPresence();
    if (user.roomCode) emitDmPresence(user.roomCode);
    io.emit("chat:author-renamed", { from: previousName, to: name });
    if (typeof ack === "function") ack({ ok: true, name, from: previousName, rewritten: rewritten || 0 });
  });

  socket.on("admin:login", (payload = {}, ack) => {
    const password = typeof payload.password === "string" ? payload.password.trim() : "";
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в чат" });
      return;
    }
    if (password !== ADMIN_PASSWORD) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный пароль" });
      return;
    }
    if (!isReservedAdminName(user.name)) {
      user.previousName = user.name;
      socket.data.previousName = user.name;
    }
    claimName(ADMIN_DISPLAY_NAME, socket.id);
    user.isAdmin = true;
    socket.data.isAdmin = true;
    user.name = ADMIN_DISPLAY_NAME;
    socket.data.name = ADMIN_DISPLAY_NAME;
    const token = issueAdminToken();
    emitChatPresence();
    if (user.roomCode) emitDmPresence(user.roomCode);
    if (typeof ack === "function") {
      ack({
        ok: true,
        name: ADMIN_DISPLAY_NAME,
        token,
        previousName: user.previousName || null,
      });
    }
  });

  socket.on("admin:resume", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в чат" });
      return;
    }
    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    if (!isValidAdminToken(token)) {
      if (typeof ack === "function") ack({ ok: false, error: "Сессия админа устарела" });
      return;
    }
    const prevFromClient = sanitizeName(payload.previousName);
    if (prevFromClient && !isReservedAdminName(prevFromClient)) {
      user.previousName = prevFromClient;
      socket.data.previousName = prevFromClient;
    } else if (!user.previousName && !isReservedAdminName(user.name)) {
      user.previousName = user.name;
      socket.data.previousName = user.name;
    }
    user.isAdmin = true;
    socket.data.isAdmin = true;
    claimName(ADMIN_DISPLAY_NAME, socket.id);
    user.name = ADMIN_DISPLAY_NAME;
    socket.data.name = ADMIN_DISPLAY_NAME;
    emitChatPresence();
    if (user.roomCode) emitDmPresence(user.roomCode);
    if (typeof ack === "function") {
      ack({
        ok: true,
        name: ADMIN_DISPLAY_NAME,
        previousName: user.previousName || null,
      });
    }
  });

  socket.on("admin:logout", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в чат" });
      return;
    }
    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    if (token) revokeAdminToken(token);

    let restore = sanitizeName(payload.name);
    if (!restore || isReservedAdminName(restore)) {
      restore = user.previousName || socket.data.previousName || null;
    }
    if (!restore || isReservedAdminName(restore) || isNameTaken(restore, socket.id, getSocketAccountId(socket))) {
      restore = uniqueRandomName();
    }

    user.isAdmin = false;
    socket.data.isAdmin = false;
    user.name = restore;
    socket.data.name = restore;
    user.previousName = null;
    socket.data.previousName = null;

    emitChatPresence();
    if (user.roomCode) emitDmPresence(user.roomCode);
    if (typeof ack === "function") ack({ ok: true, name: restore, admin: false });
  });

  socket.on("admin:ping-all", async (_payload = {}, ack) => {
    if (typeof ack === "function") {
      ack({ ok: false, error: "Функция «Позвать» отключена" });
    }
  });

  socket.on("dm:admin-rooms", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user || !(user.isAdmin || socket.data.isAdmin)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    ensureRooms();
    /** @type {Map<string, string>} */
    const sinceByCode = new Map();
    const ingestSince = (codeRaw, sinceRaw) => {
      const code = normalizeRoomCode(codeRaw);
      if (!code) return;
      const sinceId = typeof sinceRaw === "string" ? sinceRaw.trim().slice(0, 80) : "";
      sinceByCode.set(code, sinceId);
    };
    if (Array.isArray(payload.rooms)) {
      for (const item of payload.rooms) {
        if (typeof item === "string") ingestSince(item, "");
        else if (item && typeof item === "object") ingestSince(item.code, item.sinceId);
      }
    }
    const rooms = Object.keys(store.rooms)
      .filter((code) => normalizeRoomCode(code) && !isPublicRoomCode(code))
      .map((code) => {
        const meta = roomListMeta(code, user.name, sinceByCode.get(code) || "");
        const room = store.rooms[code];
        return {
          ...meta,
          lastActiveAt: room?.lastActiveAt || room?.createdAt || "",
          createdBy: room?.createdBy || "",
        };
      })
      .filter((row) => row && normalizeRoomCode(row.code))
      .sort((a, b) => {
        const ta = Date.parse(String(a.lastActiveAt || "")) || 0;
        const tb = Date.parse(String(b.lastActiveAt || "")) || 0;
        return tb - ta;
      })
      .slice(0, 200);
    if (typeof ack === "function") ack({ ok: true, rooms });
  });

  socket.on("dm:create", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    if (user.isAdmin || socket.data.isAdmin) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Супер-админ смотрит комнаты, не создаёт свои" });
      }
      return;
    }
    const accountId = getSocketAccountId(socket);
    ensureAccounts();
    const account = accountId ? store.accounts[accountId] : null;
    if (!account?.pinHash) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Сначала войдите с ником и пином" });
      }
      return;
    }
    // Prefer account pin as room admin key; still accept payload.adminKey for old clients.
    const adminKey = normalizeRoomKey(payload.adminKey || payload.key);
    const adminDigest = adminKey ? hashRoomKey(adminKey) : account.pinHash;
    // joinKey field: empty → open for others; 4 digits → keyed.
    // Legacy clients: access + single key (admin pin doubles as join key).
    const hasJoinField = Object.prototype.hasOwnProperty.call(payload, "joinKey");
    const joinKey = normalizeRoomKey(payload.joinKey);
    let roomAccess;
    let joinDigest = "";
    if (hasJoinField) {
      roomAccess = joinKey ? "keyed" : "open";
      joinDigest = joinKey ? hashRoomKey(joinKey) : "";
    } else {
      roomAccess = payload.access === "keyed" ? "keyed" : "open";
      joinDigest = roomAccess === "keyed" ? (adminKey ? hashRoomKey(adminKey) : account.pinHash) : "";
    }
    leaveDmRoom(socket);
    ensureRooms();
    const preferred = normalizeRoomCode(payload.code);
    let remapped = false;
    let code = null;
    if (
      preferred &&
      preferred !== PUBLIC_ROOM_CODE &&
      !store.rooms[preferred]
    ) {
      code = preferred;
    } else {
      if (preferred) remapped = true;
      code = generateRoomCode();
    }
    if (!code) {
      if (typeof ack === "function") ack({ ok: false, error: "Нет свободных комнат" });
      return;
    }
    const ownerClientId = normalizeClientId(user.clientId || socket.data.clientId);
    store.rooms[code] = {
      code,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      createdBy: user.name,
      ownerClientId: ownerClientId || "",
      ownerAccountId: accountId,
      access: roomAccess,
      adminKeyHash: adminDigest,
      keyHash: joinDigest,
      closed: false,
      participants: [user.name],
      messages: [],
      pinnedIds: [],
    };
    saveStore(store);
    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    socket.data.roomGhost = false;
    // Stay as normal user — admin mode is an explicit unlock.
    clearRoomAdmin(socket);
    user.roomCode = code;
    const snap = roomSnapshot(code);
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        remapped: Boolean(remapped),
        preferred: preferred || "",
        label: snap?.label || "",
        messages: snap.messages,
        pinned: snap.pinned || [],
        count: roomOnlineCount(code),
        names: roomMemberNames(code),
        participants: roomParticipantNames(code),
        maxMembers: MAX_ROOM_MEMBERS,
        ghost: false,
        roomAdmin: false,
        isOwner: true,
        ...roomPublicFlags(store.rooms[code]),
      });
    }
    emitDmPresence(code);
  });

  socket.on("dm:invite", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const toId = typeof payload.toId === "string" ? payload.toId.trim() : "";
    if (!toId || toId === socket.id) {
      if (typeof ack === "function") ack({ ok: false, error: "Выберите участника" });
      return;
    }
    const target = online.get(toId);
    if (!target) {
      if (typeof ack === "function") ack({ ok: false, error: "Участник уже не онлайн" });
      return;
    }
    ensureRooms();
    let code = typeof user.roomCode === "string" ? user.roomCode : null;
    let created = false;
    if (code && store.rooms[code]) {
      if (roomOnlineCount(code) >= MAX_ROOM_MEMBERS) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            error: `Комната заполнена (${MAX_ROOM_MEMBERS})`,
          });
        }
        return;
      }
      rememberRoomParticipant(code, user.name);
      touchRoom(code);
    } else {
      leaveDmRoom(socket);
      code = generateRoomCode();
      if (!code) {
        if (typeof ack === "function") ack({ ok: false, error: "Нет свободных комнат" });
        return;
      }
      store.rooms[code] = {
        code,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        createdBy: user.name,
        ownerClientId: normalizeClientId(user.clientId || socket.data.clientId) || "",
        access: "open",
        keyHash: "",
        closed: false,
        participants: [user.name],
        messages: [],
        pinnedIds: [],
      };
      created = true;
      socket.join(roomChannel(code));
      socket.data.roomCode = code;
      user.roomCode = code;
    }
    saveStore(store);
    const snap = roomSnapshot(code);
    const targetSocket = io.sockets.sockets.get(toId);
    if (targetSocket) {
      targetSocket.emit("dm:invite", {
        code,
        from: user.name,
        fromId: socket.id,
      });
    }
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        label: snap?.label || "",
        messages: snap.messages,
        pinned: snap?.pinned || [],
        count: roomOnlineCount(code),
        names: roomMemberNames(code),
        participants: roomParticipantNames(code),
        invited: target.name,
        maxMembers: MAX_ROOM_MEMBERS,
        created,
      });
    }
    emitDmPresence(code);
  });

  socket.on("dm:invite-decline", (payload = {}) => {
    const fromId = typeof payload.fromId === "string" ? payload.fromId.trim() : "";
    if (!fromId) return;
    const name = socket.data.name || "Участник";
    io.to(fromId).emit("dm:invite-declined", { name });
  });

  socket.on("dm:rooms-meta", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    /** @type {{code:string,sinceId:string}[]} */
    const requests = [];
    const seen = new Set();
    const pushReq = (codeRaw, sinceRaw) => {
      const code = normalizeRoomCode(codeRaw);
      if (!code || seen.has(code)) return;
      seen.add(code);
      requests.push({
        code,
        sinceId: typeof sinceRaw === "string" ? sinceRaw.trim().slice(0, 80) : "",
      });
    };
    if (Array.isArray(payload.rooms)) {
      for (const item of payload.rooms) {
        if (typeof item === "string") pushReq(item, "");
        else if (item && typeof item === "object") pushReq(item.code, item.sinceId);
        if (requests.length >= 24) break;
      }
    } else if (Array.isArray(payload.codes)) {
      for (const item of payload.codes) {
        pushReq(item, "");
        if (requests.length >= 24) break;
      }
    }
    if (typeof ack === "function") {
      ack({
        ok: true,
        rooms: requests.map((req) => roomListMeta(req.code, user.name, req.sinceId)),
      });
    }
  });

  socket.on("dm:join", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const asAdmin = Boolean(user.isAdmin || socket.data.isAdmin);
    const code = normalizeRoomCode(payload.code);
    if (!code) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Нужен номер из ровно 6 цифр (например 000543)" });
      }
      return;
    }
    ensureRooms();
    if (isPublicRoomCode(code) && !asAdmin && isRoomsOnlyClient(user.clientId)) {
      if (typeof ack === "function") {
        ack({ ok: false, error: `${PUBLIC_CHAT_LABEL} недоступен для этого устройства` });
      }
      return;
    }
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден — проверьте номер" });
      return;
    }

    const key = normalizeRoomKey(payload.key);
    const alreadyHere = socket.data.roomCode === code;
    // Already inside: stay even if the join key was just changed.
    // Fresh join / other device: must present the current key.
    if (!asAdmin && !isPublicRoomCode(code) && !alreadyHere) {
      if (isRoomClosed(room)) {
        if (typeof ack === "function") ack({ ok: false, error: "Комната закрыта" });
        return;
      }
      if (roomAccessMode(room) === "keyed") {
        const joinHash = roomJoinKeyHash(room);
        if (!joinHash || !key || hashRoomKey(key) !== joinHash) {
          if (typeof ack === "function") {
            ack({
              ok: false,
              error: "Комната по ключу — введите 4 цифры",
              needsKey: true,
              ...roomPublicFlags(room),
            });
          }
          return;
        }
      }
    }

    const isOwner = isRoomOwner(socket, room);

    const ackJoin = (snap) => {
      if (typeof ack !== "function") return;
      ack({
        ok: true,
        code,
        label: snap?.label || "",
        public: isPublicRoomCode(code),
        messages: snap.messages,
        pinned: snap.pinned || [],
        count: roomOnlineCount(code),
        names: roomMemberNames(code),
        participants: roomParticipantNames(code),
        maxMembers: MAX_ROOM_MEMBERS,
        ghost: asAdmin,
        roomAdmin: asAdmin
          ? false
          : Boolean(socket.data.roomAdmin && socket.data.roomAdminCode === code),
        isOwner: Boolean(
          isOwner || (!room.ownerClientId && !room.ownerAccountId && Boolean(roomAdminKeyHash(room)))
        ),
        ...roomPublicFlags(room),
      });
    };
    if (socket.data.roomCode === code) {
      touchRoom(code, { persist: true });
      if (!asAdmin) rememberRoomParticipant(code, user.name);
      ackJoin(roomSnapshot(code));
      return;
    }
    leaveDmRoom(socket);
    if (!asAdmin && roomOnlineCount(code) >= MAX_ROOM_MEMBERS) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          error: `Комната заполнена (${MAX_ROOM_MEMBERS}). Зайдите, когда кто-то выйдет.`,
        });
      }
      return;
    }
    touchRoom(code);
    if (!asAdmin) {
      rememberRoomParticipant(code, user.name);
      saveStore(store);
    }
    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    socket.data.roomGhost = asAdmin;
    user.roomCode = code;
    ackJoin(roomSnapshot(code));
    emitDmPresence(code);
  });

  socket.on("room:admin-login", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    if (socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: true, roomAdmin: false, superAdmin: true });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в свою комнату" });
      return;
    }
    ensureRooms();
    ensureAccounts();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    const key = normalizeRoomKey(payload.key);
    if (!key) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный пин админа" });
      return;
    }
    const pinDigest = hashAccountPin(key);
    const accountId = getSocketAccountId(socket);
    const clientId = normalizeClientId(user.clientId || socket.data.clientId);
    const adminHash = roomAdminKeyHash(room);

    let allowed = false;
    if (room.ownerAccountId && accountId && room.ownerAccountId === accountId) {
      const acc = store.accounts[accountId];
      if (acc?.pinHash && pinDigest === acc.pinHash) allowed = true;
      else {
        if (typeof ack === "function") ack({ ok: false, error: "Неверный пин" });
        return;
      }
    } else if (
      accountId &&
      adminHash &&
      store.accounts[accountId]?.pinHash === adminHash &&
      pinDigest === adminHash
    ) {
      // Rooms created with account pinHash as adminKeyHash.
      allowed = true;
    } else if (adminHash && pinDigest === adminHash) {
      if (room.ownerClientId && clientId && room.ownerClientId !== clientId) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Режим админа только у создателя комнаты" });
        }
        return;
      }
      allowed = true;
    } else if (!adminHash) {
      if (typeof ack === "function") ack({ ok: false, error: "У этой комнаты нет пина админа" });
      return;
    } else {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный пин админа" });
      return;
    }

    if (!allowed) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный пин админа" });
      return;
    }

    socket.data.roomAdmin = true;
    socket.data.roomAdminCode = code;
    emitDmPresence(code);
    if (typeof ack === "function") {
      ack({ ok: true, roomAdmin: true, isOwner: true, code, ...roomPublicFlags(room) });
    }
  });

  socket.on("room:admin-logout", (_payload, ack) => {
    const code = socket.data.roomCode;
    clearRoomAdmin(socket);
    if (code) emitDmPresence(code);
    if (typeof ack === "function") ack({ ok: true, roomAdmin: false });
  });

  socket.on("room:close", (_payload, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа комнаты" });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Эту комнату нельзя закрыть" });
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    room.closed = true;
    saveStore(store);
    for (const id of roomSocketIds(code)) {
      if (id === socket.id) continue;
      const sock = io.sockets.sockets.get(id);
      const u = online.get(id);
      if (!sock) continue;
      if (u?.isAdmin || sock.data?.isAdmin) continue;
      leaveDmRoom(sock);
      sock.emit("dm:room-gone", { code, reason: "closed" });
      sock.emit("chat:state", emptyPublicSnapshot());
    }
    emitDmPresence(code);
    if (typeof ack === "function") ack({ ok: true, closed: true, code });
  });

  socket.on("room:reopen", (_payload, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа комнаты" });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нельзя" });
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    room.closed = false;
    saveStore(store);
    if (typeof ack === "function") ack({ ok: true, closed: false, code });
  });

  socket.on("room:change-admin-key", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Включите режим админа комнаты" });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    if (!isRoomOwner(socket, room) && !isSuperAdminSocket(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только создатель" });
      return;
    }
    const currentKey = normalizeRoomKey(payload.currentKey);
    const newKey = normalizeRoomKey(payload.newKey);
    const adminHash = roomAdminKeyHash(room);
    if (!verifyOwnerConfirmKey(socket, room, currentKey)) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный текущий пин админа" });
      return;
    }
    if (!newKey) {
      if (typeof ack === "function") ack({ ok: false, error: "Новый пин — ровно 4 цифры" });
      return;
    }
    room.adminKeyHash = hashRoomKey(newKey);
    // Keep legacy field in sync when join key was shared.
    if (roomAccessMode(room) !== "keyed" && room.keyHash && room.keyHash === adminHash) {
      room.keyHash = "";
    }
    saveStore(store);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("room:change-join-key", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужен режим админа" });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    if (!isRoomOwner(socket, room) && !isSuperAdminSocket(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только создатель" });
      return;
    }
    const currentKey = normalizeRoomKey(payload.currentKey);
    const newKey = normalizeRoomKey(payload.newKey);
    // Prove with account pin (account-owned) or admin password (legacy).
    if (!verifyOwnerConfirmKey(socket, room, currentKey)) {
      if (typeof ack === "function") ack({ ok: false, error: "Подтвердите пином админа" });
      return;
    }
    const makeKeyed = payload.access === "keyed" || roomAccessMode(room) === "keyed" || Boolean(newKey);
    if (payload.access === "open") {
      room.access = "open";
      room.keyHash = "";
      saveStore(store);
      io.to(roomChannel(code)).emit("room:flags", { code, ...roomPublicFlags(room) });
      if (typeof ack === "function") ack({ ok: true, ...roomPublicFlags(room) });
      return;
    }
    if (!newKey) {
      if (typeof ack === "function") ack({ ok: false, error: "Новый ключ входа — ровно 4 цифры" });
      return;
    }
    room.access = "keyed";
    room.keyHash = hashRoomKey(newKey);
    saveStore(store);
    // Occupants stay; only new joins (incl. other devices) need the new key.
    io.to(roomChannel(code)).emit("room:flags", { code, ...roomPublicFlags(room) });
    if (typeof ack === "function") ack({ ok: true, ...roomPublicFlags(room) });
  });

  socket.on("room:delete", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужен режим админа" });
      return;
    }
    const code = normalizeRoomCode(payload.code);
    const key = normalizeRoomKey(payload.key);
    const current = socket.data.roomCode;
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Укажите номер комнаты" });
      return;
    }
    // Super-admin may delete from the hub list without entering the room.
    if (code !== current && !isSuperAdminSocket(socket)) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Номер не совпадает с текущей комнатой" });
      }
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    if (!isRoomOwner(socket, room) && !isSuperAdminSocket(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только создатель" });
      return;
    }
    // Super-admin may delete any room without the owner's pin.
    if (!isSuperAdminSocket(socket) && !verifyOwnerConfirmKey(socket, room, key)) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный ключ — комната не удалена" });
      return;
    }
    // Foolproof: both number (already matched) and admin key verified.
    unlinkRoomImages(room);
    for (const id of roomSocketIds(code)) {
      const sock = io.sockets.sockets.get(id);
      if (!sock) continue;
      leaveDmRoom(sock);
      sock.emit("dm:room-gone", { code, reason: "deleted" });
      sock.emit("chat:state", emptyPublicSnapshot());
    }
    delete store.rooms[code];
    saveStore(store);
    if (typeof ack === "function") ack({ ok: true, deleted: true, code });
  });

  socket.on("dm:leave", (_payload, ack) => {
    const code = socket.data.roomCode;
    leaveDmRoom(socket);
    if (typeof ack === "function") ack({ ok: true, code: code || null });
    socket.emit("chat:state", emptyPublicSnapshot());
  });

  socket.on("chat:message", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const text = sanitizeText(payload.text);
    const imageUrl =
      typeof payload.imageUrl === "string" &&
      payload.imageUrl.startsWith("/uploads/") &&
      !payload.imageUrl.includes("..")
        ? payload.imageUrl
        : null;

    if (!text && !imageUrl) {
      if (typeof ack === "function") ack({ ok: false, error: "Пустое сообщение" });
      return;
    }

    const roomCode = socket.data.roomCode || null;
    if (!roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату по номеру" });
      return;
    }
    if (isPublicRoomCode(roomCode) && isRoomsOnlyClient(user.clientId)) {
      if (typeof ack === "function") {
        ack({ ok: false, error: `${PUBLIC_CHAT_LABEL} недоступен для этого устройства` });
      }
      return;
    }
    ensureRooms();
    const messageList = store.rooms[roomCode] ? store.rooms[roomCode].messages : null;
    if (!messageList) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }

    let reply = null;
    const replyId = typeof payload.replyToId === "string" ? payload.replyToId : "";
    if (replyId) {
      const target = messageList.find((m) => m.id === replyId);
      if (target) {
        const preview = (target.text || (target.imageUrl ? "📷 Фото" : "Сообщение"))
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
        reply = { id: target.id, name: target.name, text: preview };
      }
    }

    const asSuper = Boolean(user.isAdmin || socket.data.isAdmin);
    const asRoomAdmin =
      !asSuper &&
      Boolean(socket.data.roomAdmin && socket.data.roomAdminCode === roomCode);
    const msg = {
      id: randomUUID(),
      name: asSuper ? ADMIN_DISPLAY_NAME : user.name,
      text,
      imageUrl,
      reply,
      reactions: {},
      admin: asSuper,
      roomAdmin: asRoomAdmin,
      createdAt: new Date().toISOString(),
    };
    messageList.push(msg);
    touchRoom(roomCode);
    rememberRoomParticipant(roomCode, msg.name);
    const room = store.rooms[roomCode];
    if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
    if (messageList.length > MAX_ROOM_MESSAGES) {
      const removed = messageList.splice(0, messageList.length - MAX_ROOM_MESSAGES);
      const keep = new Set(messageList.map((m) => m.id));
      room.pinnedIds = room.pinnedIds.filter((id) => keep.has(id));
      for (const old of removed) {
        if (old.imageUrl && !room.pinnedIds.includes(old.id)) {
          const file = path.join(UPLOAD_DIR, path.basename(old.imageUrl));
          fs.promises.unlink(file).catch(() => {});
        }
      }
    }
    saveStore(store);
    const pub = publicRoomMessage(msg, roomCode);
    emitRoomMessage(roomCode, pub);

    if (isPublicRoomCode(roomCode)) {
      // Fan-out like the old public chat (notifyPublic prefs).
      if (msg.reply?.name && nameKey(msg.reply.name) !== nameKey(msg.name)) {
        void pushToName(
          msg.reply.name,
          {
            title: `${msg.name} ответил`,
            body: previewPushBody(msg),
            tag: `reply-${msg.reply.id || msg.id}`,
            id: msg.id,
            url: "/",
            badge: 1,
            kind: "public",
            roomCode,
          },
          "public"
        );
      } else {
        const authorKey = nameKey(msg.name);
        const targets = pushSubs.filter(
          (s) => nameKey(s.name) && nameKey(s.name) !== authorKey && wantsPublicPush(s)
        );
        void Promise.all(
          targets.map((s) =>
            sendWebPush(s, {
              title: msg.name || PUBLIC_CHAT_LABEL,
              body: previewPushBody(msg),
              tag: `msg-${msg.id}`,
              id: msg.id,
              url: "/",
              badge: 1,
              kind: "public",
              roomCode,
            })
          )
        );
      }
    } else {
      const targets = roomPushNames(roomCode, msg.name);
      for (const name of targets) {
        void pushToName(
          name,
          {
            title: msg.name || "Комната",
            body: previewPushBody(msg),
            tag: `dm-${roomCode}`,
            id: msg.id,
            url: "/",
            badge: 1,
            kind: "dm",
            roomCode,
          },
          "dm"
        );
      }
    }
    if (typeof ack === "function") ack({ ok: true, id: msg.id });
  });

  socket.on("chat:react", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const emoji = typeof payload.emoji === "string" ? payload.emoji : "";
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!REACTION_EMOJIS.includes(emoji)) {
      if (typeof ack === "function") ack({ ok: false, error: "Неизвестная реакция" });
      return;
    }
    const roomCode = socket.data.roomCode || null;
    if (!roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату" });
      return;
    }
    ensureRooms();
    const msg = store.rooms[roomCode]?.messages?.find((m) => m.id === id) || null;
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (msg.name === user.name) {
      if (typeof ack === "function") ack({ ok: false, error: "На своё сообщение реакцию не ставят" });
      return;
    }
    if (!msg.reactions || typeof msg.reactions !== "object") msg.reactions = {};
    const list = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : [];
    const idx = list.indexOf(user.name);
    const added = idx < 0;
    if (idx >= 0) list.splice(idx, 1);
    else list.push(user.name);
    if (list.length) msg.reactions[emoji] = list;
    else delete msg.reactions[emoji];
    msg.reactions = normalizeReactions(msg.reactions);
    saveStore(store);
    const pub = publicRoomMessage(msg, roomCode);
    emitRoomMessageUpdate(roomCode, pub);
    if (typeof ack === "function") ack({ ok: true, message: pub, added });
  });

  socket.on("admin:pin", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const roomCode = socket.data.roomCode || null;
    if (!roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату" });
      return;
    }
    ensureRooms();
    const room = store.rooms[roomCode];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
    const id = payload.id;
    const msg = (room.messages || []).find((m) => m.id === id);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (!room.pinnedIds.includes(id)) {
      room.pinnedIds.unshift(id);
      room.pinnedIds = room.pinnedIds.slice(0, 20);
      saveStore(store);
    }
    emitRoomState(roomCode);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:unpin", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const roomCode = socket.data.roomCode || null;
    if (!roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату" });
      return;
    }
    ensureRooms();
    const room = store.rooms[roomCode];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
    room.pinnedIds = room.pinnedIds.filter((id) => id !== payload.id);
    saveStore(store);
    emitRoomState(roomCode);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:ban", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const targetId = typeof payload.socketId === "string" ? payload.socketId.trim() : "";
    const target = targetId ? online.get(targetId) : null;
    const clientId = normalizeClientId(payload.clientId) || normalizeClientId(target?.clientId);
    if (!clientId) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Нет id устройства — пользователь слишком старый клиент" });
      }
      return;
    }
    if (target?.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Админа нельзя заблокировать" });
      return;
    }
    banClient(clientId, {
      name: target?.name || "",
      reason: typeof payload.reason === "string" ? payload.reason : "Бан",
      by: socket.data.name || "АДМИН",
    });
    for (const id of findOnlineByClientId(clientId)) {
      kickBannedOrRestricted(id, "Вас заблокировали в Сарафане");
    }
    emitChatPresence();
    if (typeof ack === "function") ack({ ok: true, clientId });
  });

  socket.on("admin:rooms-only", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const on = payload.on !== false;
    const targetId = typeof payload.socketId === "string" ? payload.socketId.trim() : "";
    const target = targetId ? online.get(targetId) : null;
    const clientId = normalizeClientId(payload.clientId) || normalizeClientId(target?.clientId);
    if (!clientId) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Нет id устройства — пусть человек обновит страницу" });
      }
      return;
    }
    if (target?.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Админу это не нужно" });
      return;
    }
    if (isBannedClient(clientId)) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала разблокируйте" });
      return;
    }
    const ok = setRoomsOnlyClient(clientId, on, {
      name: target?.name || "",
      label: typeof payload.label === "string" ? payload.label : "",
    });
    if (!ok && on) {
      if (typeof ack === "function") ack({ ok: false, error: "Не удалось" });
      return;
    }
    for (const id of findOnlineByClientId(clientId)) {
      const u = online.get(id);
      const sock = io.sockets.sockets.get(id);
      if (!u || !sock) continue;
      notifyAccessUpdate(id);
      if (on && isPublicRoomCode(u.roomCode)) {
        leaveDmRoom(sock);
        sock.emit("chat:state", emptyPublicSnapshot());
        sock.emit("access:forced-hub", { reason: "public-hidden" });
      }
    }
    emitChatPresence();
    if (typeof ack === "function") {
      ack({
        ok: true,
        clientId,
        roomsOnly: on,
        publicLabel: PUBLIC_CHAT_LABEL,
        publicRoomCode: PUBLIC_ROOM_CODE,
      });
    }
  });

  socket.on("admin:unban", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const clientId = normalizeClientId(payload.clientId);
    if (!clientId) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужен id" });
      return;
    }
    unbanClient(clientId);
    if (typeof ack === "function") ack({ ok: true, clientId });
  });

  socket.on("admin:delete", (payload = {}, ack) => {
    if (!canModerateRoom(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const roomCode = socket.data.roomCode || null;
    if (!roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату" });
      return;
    }
    ensureRooms();
    const room = store.rooms[roomCode];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден" });
      return;
    }
    const idx = room.messages.findIndex((m) => m.id === payload.id);
    if (idx === -1) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    const [removed] = room.messages.splice(idx, 1);
    if (Array.isArray(room.pinnedIds)) {
      room.pinnedIds = room.pinnedIds.filter((id) => id !== payload.id);
    }
    saveStore(store);
    if (removed.imageUrl) {
      const file = path.join(UPLOAD_DIR, path.basename(removed.imageUrl));
      fs.promises.unlink(file).catch(() => {});
    }
    emitRoomMessageRemoved(roomCode, { id: removed.id });
    if (typeof ack === "function") ack({ ok: true, id: removed.id });
  });

  socket.on("disconnect", () => {
    leaveDmRoom(socket);
    online.delete(socket.id);
    emitChatPresence();
  });
});

server.listen(PORT, () => {
  console.log(`Сарафан listening on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === "change-me" ? "change-me (set ADMIN_PASSWORD)" : "(set via env)"}`);
  const removed = pruneInactiveRooms();
  if (removed.length) {
    console.log(`Pruned ${removed.length} inactive DM room(s) (>${Math.round(ROOM_IDLE_MS / 86400000)}d idle)`);
  }
  setInterval(() => {
    const gone = pruneInactiveRooms();
    if (gone.length) {
      console.log(`Pruned ${gone.length} inactive DM room(s)`);
      for (const code of gone) kickSocketsFromRoom(code);
    }
  }, ROOM_PRUNE_INTERVAL_MS).unref?.();
});
