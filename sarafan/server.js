const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const sharp = require("sharp");
const { Server } = require("socket.io");
const { randomBytes } = require("crypto");

const { loadStore, saveStore, flushStore, DATA_DIR, ensureDataDir } = require("./lib/store");
const { vapid, upsertPushSub, removePushSub, pushToName } = require("./lib/push");
const {
  PUBLIC_ROOM_CODE,
  PUBLIC_CHAT_LABEL,
  ADMIN_DISPLAY_NAME,
  hashPin,
  normalizePin,
  normalizeRoomCode,
  sanitizeName,
  nameKey,
  isReservedAdminName,
  isPublicRoomCode,
  randomName,
  newAccountId,
  newMessageId,
  generateRoomCode,
} = require("./lib/util");

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const IMAGE_MAX_PX = Number(process.env.IMAGE_MAX_PX) || 1080;
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY) || 52;
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES) || 180 * 1024;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const MAX_MESSAGES = 4000;
const MAX_TEXT_LEN = 2000;
const MAX_ROOM_MEMBERS = 80;
const MAX_ADMIN_TOKENS = 80;
const ADMIN_TOKENS_PATH = path.join(DATA_DIR, "admin-tokens.json");

ensureDataDir();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const store = loadStore();
ensurePublicRoom();

function ensurePublicRoom() {
  let room = store.rooms[PUBLIC_ROOM_CODE];
  if (!room) {
    room = {
      code: PUBLIC_ROOM_CODE,
      label: PUBLIC_CHAT_LABEL,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      createdBy: PUBLIC_CHAT_LABEL,
      ownerAccountId: "",
      ownerClientId: "",
      access: "open",
      keyHash: "",
      closed: false,
      participants: [],
      messages: [],
      pinnedIds: [],
    };
    store.rooms[PUBLIC_ROOM_CODE] = room;
    saveStore(store, { flush: true });
  }
  if (!Array.isArray(room.messages)) room.messages = [];
  if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
  if (!room.label) room.label = PUBLIC_CHAT_LABEL;
}

function loadAdminTokens() {
  try {
    if (!fs.existsSync(ADMIN_TOKENS_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(ADMIN_TOKENS_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let adminTokens = loadAdminTokens();

function saveAdminTokens() {
  fs.writeFileSync(ADMIN_TOKENS_PATH, JSON.stringify(adminTokens));
}

function issueAdminToken() {
  const token = randomBytes(32).toString("hex");
  adminTokens.push(token);
  if (adminTokens.length > MAX_ADMIN_TOKENS) {
    adminTokens = adminTokens.slice(-MAX_ADMIN_TOKENS);
  }
  saveAdminTokens();
  return token;
}

function isValidAdminToken(token) {
  return typeof token === "string" && token.length >= 20 && adminTokens.includes(token);
}

function revokeAdminToken(token) {
  const next = adminTokens.filter((t) => t !== token);
  if (next.length !== adminTokens.length) {
    adminTokens = next;
    saveAdminTokens();
  }
}

function findAccountByNick(nick) {
  const key = nameKey(nick);
  for (const acc of Object.values(store.accounts)) {
    if (nameKey(acc.nick) === key) return acc;
  }
  return null;
}

function createAccount(nick, pin) {
  const pinHash = hashPin(pin);
  if (!pinHash) return null;
  const account = {
    id: newAccountId(),
    nick: sanitizeName(nick),
    pinHash,
    createdAt: new Date().toISOString(),
  };
  store.accounts[account.id] = account;
  return account;
}

function roomFlags(room) {
  return {
    keyed: room?.access === "keyed",
    closed: Boolean(room?.closed),
    access: room?.access === "keyed" ? "keyed" : "open",
  };
}

function roomChannel(code) {
  return `room:${code}`;
}

function isOwner(socket, room) {
  if (!socket || !room) return false;
  const accountId = socket.data.accountId || "";
  if (room.ownerAccountId && accountId && room.ownerAccountId === accountId) return true;
  const clientId = socket.data.clientId || "";
  if (room.ownerClientId && clientId && room.ownerClientId === clientId) return true;
  return false;
}

function isSuper(socket) {
  return Boolean(socket?.data?.isAdmin);
}

function canModerate(socket, room) {
  return isSuper(socket) || isOwner(socket, room);
}

function touchRoom(code) {
  const room = store.rooms[code];
  if (!room) return;
  room.lastActiveAt = new Date().toISOString();
}

function rememberParticipant(code, name) {
  const room = store.rooms[code];
  if (!room || isPublicRoomCode(code) || isReservedAdminName(name)) return;
  if (!Array.isArray(room.participants)) room.participants = [];
  if (!room.participants.includes(name)) {
    room.participants.push(name);
    if (room.participants.length > 200) room.participants = room.participants.slice(-200);
  }
}

function messageView(msg) {
  return {
    id: msg.id,
    name: msg.name,
    text: msg.text || "",
    imageUrl: msg.imageUrl || "",
    createdAt: msg.createdAt,
    replyTo: msg.replyTo || null,
    reactions: msg.reactions || {},
    admin: Boolean(msg.admin),
    roomAdmin: Boolean(msg.roomAdmin),
  };
}

function roomSnapshot(code) {
  const room = store.rooms[code];
  if (!room) return null;
  const pinnedSet = new Set(room.pinnedIds || []);
  const messages = (room.messages || []).slice(-500).map(messageView);
  const pinned = (room.messages || [])
    .filter((m) => pinnedSet.has(m.id))
    .map(messageView);
  return {
    code,
    label: room.label || (isPublicRoomCode(code) ? PUBLIC_CHAT_LABEL : ""),
    messages,
    pinned,
  };
}

function roomOnlineCount(code, online) {
  let n = 0;
  for (const u of online.values()) {
    if (u.roomCode === code && !u.isAdmin) n += 1;
  }
  return n;
}

function roomMemberNames(code, online) {
  const names = [];
  for (const u of online.values()) {
    if (u.roomCode === code && !u.isAdmin) names.push(u.name);
  }
  return names;
}

function emptyPublicSnapshot() {
  return { messages: [], pinned: [] };
}

function ownedRoomCodes(accountId) {
  if (!accountId) return [];
  return Object.keys(store.rooms).filter(
    (code) => !isPublicRoomCode(code) && store.rooms[code]?.ownerAccountId === accountId
  );
}

function catalogRooms() {
  return Object.values(store.rooms)
    .filter((r) => r && !isPublicRoomCode(r.code))
    .map((r) => ({
      code: r.code,
      messageCount: Array.isArray(r.messages) ? r.messages.length : 0,
      lastActiveAt: r.lastActiveAt || r.createdAt || "",
      createdBy: r.createdBy || "",
      ...roomFlags(r),
      foreign: true,
    }))
    .sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)))
    .slice(0, 300);
}

function unlinkRoomImages(room) {
  for (const msg of room.messages || []) {
    const url = msg.imageUrl || "";
    const m = url.match(/\/uploads\/([^/?#]+)/);
    if (!m) continue;
    const file = path.join(UPLOAD_DIR, m[1]);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.post("/api/push-subscribe", (req, res) => {
  const ok = upsertPushSub({
    subscription: req.body?.subscription,
    name: req.body?.name,
    clientId: req.body?.clientId,
    channels: req.body?.channels,
  });
  res.status(ok ? 200 : 400).json({ ok });
});

app.post("/api/push-unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) removePushSub(endpoint);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Нет файла" });
    let pipeline = sharp(req.file.buffer).rotate();
    const meta = await pipeline.metadata();
    const w = meta.width || IMAGE_MAX_PX;
    const h = meta.height || IMAGE_MAX_PX;
    if (w > IMAGE_MAX_PX || h > IMAGE_MAX_PX) {
      pipeline = pipeline.resize({
        width: IMAGE_MAX_PX,
        height: IMAGE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    let out = await pipeline.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true }).toBuffer();
    if (out.length > IMAGE_MAX_BYTES) {
      out = await sharp(out)
        .jpeg({ quality: Math.max(30, IMAGE_QUALITY - 15), mozjpeg: true })
        .toBuffer();
    }
    const name = `${Date.now()}-${randomBytes(4).toString("hex")}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), out);
    res.json({ ok: true, url: `/uploads/${name}` });
  } catch (err) {
    console.error("upload:", err.message);
    res.status(500).json({ ok: false, error: "Не удалось обработать фото" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "sarafan" }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingInterval: 20000,
  pingTimeout: 25000,
});

/** @type {Map<string, { name: string, isAdmin: boolean, roomCode: string|null, previousName: string|null, clientId: string, accountId: string }>} */
const online = new Map();

function leaveRoom(socket) {
  const user = online.get(socket.id);
  const code = socket.data.roomCode;
  if (code) {
    socket.leave(roomChannel(code));
    emitPresence(code);
  }
  socket.data.roomCode = null;
  if (user) user.roomCode = null;
}

function emitPresence(code) {
  if (!code) return;
  io.to(roomChannel(code)).emit("room:presence", {
    code,
    count: roomOnlineCount(code, online),
    names: roomMemberNames(code, online),
  });
}

function emitChatPresence() {
  const people = [];
  for (const u of online.values()) {
    if (u.isAdmin) continue;
    people.push({ name: u.name });
  }
  io.emit("chat:presence", { count: people.length, people });
}

function claimName(name, socketId) {
  for (const [id, u] of online.entries()) {
    if (id === socketId) continue;
    if (nameKey(u.name) !== nameKey(name)) continue;
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit("chat:kicked", { reason: "Тот же ник вошёл с другого устройства" });
      sock.disconnect(true);
    }
    online.delete(id);
  }
}

io.on("connection", (socket) => {
  socket.emit("chat:state", emptyPublicSnapshot());

  socket.on("chat:join", (payload = {}, ack) => {
    const adminToken =
      typeof payload.adminToken === "string" ? payload.adminToken.trim() : "";
    const asAdmin = Boolean(adminToken && isValidAdminToken(adminToken));
    const clientId =
      typeof payload.clientId === "string" && payload.clientId.length >= 8
        ? payload.clientId.slice(0, 80)
        : "";
    const prevFromClient = sanitizeName(payload.previousName);
    const previousName =
      prevFromClient && !isReservedAdminName(prevFromClient) ? prevFromClient : null;

    let name;
    let account = null;
    let accountId = "";

    if (asAdmin) {
      name = ADMIN_DISPLAY_NAME;
      const pin = normalizePin(payload.pin);
      const nickForAccount =
        previousName ||
        (sanitizeName(payload.name) && !isReservedAdminName(payload.name)
          ? sanitizeName(payload.name)
          : null);
      if (pin && nickForAccount) {
        const existing = findAccountByNick(nickForAccount);
        if (existing && existing.pinHash === hashPin(pin)) {
          account = existing;
          accountId = existing.id;
        }
      }
    } else {
      const custom = sanitizeName(payload.name);
      if (!custom) {
        if (typeof ack === "function") ack({ ok: false, error: "Введите имя" });
        return;
      }
      if (isReservedAdminName(custom)) {
        if (typeof ack === "function") ack({ ok: false, error: "Это имя занято" });
        return;
      }
      const pin = normalizePin(payload.pin);
      if (!pin) {
        if (typeof ack === "function") ack({ ok: false, error: "Нужен пин из 4 цифр" });
        return;
      }
      const existing = findAccountByNick(custom);
      if (existing) {
        if (existing.pinHash !== hashPin(pin)) {
          if (typeof ack === "function") ack({ ok: false, error: "Неверный пин" });
          return;
        }
        account = existing;
        name = account.nick;
      } else {
        account = createAccount(custom, pin);
        if (!account) {
          if (typeof ack === "function") ack({ ok: false, error: "Нужен пин из 4 цифр" });
          return;
        }
        name = account.nick;
        saveStore(store, { flush: true });
      }
      accountId = account.id;
    }

    claimName(name, socket.id);
    leaveRoom(socket);

    online.set(socket.id, {
      name,
      isAdmin: asAdmin,
      roomCode: null,
      previousName: asAdmin ? previousName : null,
      clientId,
      accountId,
    });
    socket.data.name = name;
    socket.data.isAdmin = asAdmin;
    socket.data.roomCode = null;
    socket.data.previousName = asAdmin ? previousName : null;
    socket.data.clientId = clientId;
    socket.data.accountId = accountId;

    emitChatPresence();
    if (typeof ack === "function") {
      ack({
        ok: true,
        name,
        admin: asAdmin,
        previousName: asAdmin ? previousName : null,
        publicLabel: PUBLIC_CHAT_LABEL,
        publicRoomCode: PUBLIC_ROOM_CODE,
        accountId: accountId || undefined,
        ownedRooms: asAdmin ? undefined : ownedRoomCodes(accountId),
      });
    }
  });

  socket.on("chat:random-name", (_payload, ack) => {
    if (typeof ack === "function") ack({ ok: true, name: randomName() });
  });

  socket.on("chat:rename", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    if (user.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "В админке имя всегда АДМИН" });
      return;
    }
    const name = sanitizeName(payload.name);
    if (!name) {
      if (typeof ack === "function") ack({ ok: false, error: "Пустое имя" });
      return;
    }
    if (isReservedAdminName(name)) {
      if (typeof ack === "function") ack({ ok: false, error: "Это имя занято" });
      return;
    }
    const account = store.accounts[user.accountId];
    if (!account) {
      if (typeof ack === "function") ack({ ok: false, error: "Нет аккаунта" });
      return;
    }
    for (const u of online.values()) {
      if (u !== user && nameKey(u.name) === nameKey(name)) {
        if (typeof ack === "function") ack({ ok: false, error: "Имя уже занято" });
        return;
      }
    }
    const from = user.name;
    account.nick = name;
    user.name = name;
    socket.data.name = name;
    saveStore(store);
    emitChatPresence();
    if (user.roomCode) emitPresence(user.roomCode);
    io.emit("chat:author-renamed", { from, to: name });
    if (typeof ack === "function") ack({ ok: true, name, from });
  });

  socket.on("admin:login", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const password = String(payload.password || "").trim();
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
    if (user.roomCode) emitPresence(user.roomCode);
    if (typeof ack === "function") {
      ack({
        ok: true,
        name: ADMIN_DISPLAY_NAME,
        token,
        previousName: user.previousName || null,
      });
    }
  });

  socket.on("admin:logout", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    if (payload.token) revokeAdminToken(String(payload.token));
    let restore = sanitizeName(payload.name) || user.previousName || socket.data.previousName;
    if (!restore || isReservedAdminName(restore)) restore = randomName();
    user.isAdmin = false;
    socket.data.isAdmin = false;
    user.name = restore;
    socket.data.name = restore;
    user.previousName = null;
    socket.data.previousName = null;
    emitChatPresence();
    if (user.roomCode) emitPresence(user.roomCode);
    if (typeof ack === "function") ack({ ok: true, name: restore, admin: false });
  });

  socket.on("rooms:list", (_payload, ack) => {
    if (!isSuper(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Нет доступа" });
      return;
    }
    if (typeof ack === "function") ack({ ok: true, rooms: catalogRooms() });
  });

  socket.on("room:create", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const accountId = socket.data.accountId || "";
    const account = accountId ? store.accounts[accountId] : null;
    if (!account?.pinHash && !isSuper(socket)) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Сначала войдите с ником и пином" });
      }
      return;
    }

    const joinKey = normalizePin(payload.joinKey);
    const access = joinKey ? "keyed" : "open";
    const preferred = normalizeRoomCode(payload.code);
    let remapped = false;
    let code = null;
    if (preferred && preferred !== PUBLIC_ROOM_CODE && !store.rooms[preferred]) {
      code = preferred;
    } else {
      if (preferred) remapped = true;
      code = generateRoomCode(store.rooms);
    }
    if (!code) {
      if (typeof ack === "function") ack({ ok: false, error: "Нет свободных номеров" });
      return;
    }

    leaveRoom(socket);
    store.rooms[code] = {
      code,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      createdBy: user.name,
      ownerAccountId: accountId || "",
      ownerClientId: user.clientId || socket.data.clientId || "",
      access,
      keyHash: joinKey ? hashPin(joinKey) : "",
      closed: false,
      participants: isSuper(socket) ? [] : [user.name],
      messages: [],
      pinnedIds: [],
    };
    saveStore(store, { flush: true });

    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    user.roomCode = code;

    const snap = roomSnapshot(code);
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        remapped,
        preferred: preferred || "",
        label: snap?.label || "",
        messages: snap.messages,
        pinned: snap.pinned,
        count: roomOnlineCount(code, online),
        names: roomMemberNames(code, online),
        isOwner: Boolean(accountId) || isSuper(socket),
        ghost: isSuper(socket),
        ...roomFlags(store.rooms[code]),
      });
    }
    emitPresence(code);
  });

  socket.on("room:join", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const code = normalizeRoomCode(payload.code);
    if (!code) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужен номер из 6 цифр" });
      return;
    }
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Комната не найдена" });
      return;
    }
    const asGhost = isSuper(socket);
    if (!asGhost && room.closed && !isOwner(socket, room)) {
      if (typeof ack === "function") ack({ ok: false, error: "Вход в комнату закрыт" });
      return;
    }
    if (!asGhost && room.access === "keyed") {
      const key = normalizePin(payload.key);
      if (!key || hashPin(key) !== room.keyHash) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Нужен ключ из 4 цифр", needsKey: true, ...roomFlags(room) });
        }
        return;
      }
    }
    if (!asGhost && socket.data.roomCode !== code && roomOnlineCount(code, online) >= MAX_ROOM_MEMBERS) {
      if (typeof ack === "function") {
        ack({ ok: false, error: `Комната заполнена (${MAX_ROOM_MEMBERS})` });
      }
      return;
    }

    if (socket.data.roomCode !== code) {
      leaveRoom(socket);
      socket.join(roomChannel(code));
      socket.data.roomCode = code;
      user.roomCode = code;
      if (!asGhost) {
        rememberParticipant(code, user.name);
        touchRoom(code);
        saveStore(store);
      }
      emitPresence(code);
    }

    const snap = roomSnapshot(code);
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        public: isPublicRoomCode(code),
        label: snap?.label || "",
        messages: snap.messages,
        pinned: snap.pinned,
        count: roomOnlineCount(code, online),
        names: roomMemberNames(code, online),
        isOwner: isOwner(socket, room),
        ghost: asGhost,
        ...roomFlags(room),
      });
    }
  });

  socket.on("room:leave", (_payload, ack) => {
    const code = socket.data.roomCode;
    leaveRoom(socket);
    if (typeof ack === "function") ack({ ok: true, code: code || null });
    socket.emit("chat:state", emptyPublicSnapshot());
  });

  socket.on("room:set-access", (payload = {}, ack) => {
    const user = online.get(socket.id);
    const code = socket.data.roomCode;
    const room = code ? store.rooms[code] : null;
    if (!user || !room || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    if (!canModerate(socket, room)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только владелец" });
      return;
    }
    if (!isSuper(socket)) {
      const confirm = normalizePin(payload.confirmPin);
      const acc = store.accounts[socket.data.accountId];
      if (!acc || !confirm || hashPin(confirm) !== acc.pinHash) {
        if (typeof ack === "function") ack({ ok: false, error: "Подтвердите пином аккаунта" });
        return;
      }
    }
    if (payload.access === "open") {
      room.access = "open";
      room.keyHash = "";
    } else {
      const key = normalizePin(payload.joinKey);
      if (!key) {
        if (typeof ack === "function") ack({ ok: false, error: "Ключ — 4 цифры" });
        return;
      }
      room.access = "keyed";
      room.keyHash = hashPin(key);
    }
    saveStore(store, { flush: true });
    io.to(roomChannel(code)).emit("room:flags", { code, ...roomFlags(room) });
    if (typeof ack === "function") ack({ ok: true, ...roomFlags(room) });
  });

  socket.on("room:close", (payload = {}, ack) => {
    const code = socket.data.roomCode;
    const room = code ? store.rooms[code] : null;
    if (!room || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    if (!canModerate(socket, room)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только владелец" });
      return;
    }
    const closing = payload.close !== false;
    room.closed = closing;
    saveStore(store);
    io.to(roomChannel(code)).emit("room:flags", { code, ...roomFlags(room) });
    if (closing) {
      for (const [id, u] of online.entries()) {
        if (u.roomCode !== code) continue;
        const sock = io.sockets.sockets.get(id);
        if (!sock || isSuper(sock) || isOwner(sock, room)) continue;
        leaveRoom(sock);
        sock.emit("room:gone", { code, reason: "closed" });
      }
    }
    if (typeof ack === "function") ack({ ok: true, ...roomFlags(room) });
  });

  socket.on("room:delete", (payload = {}, ack) => {
    const code = normalizeRoomCode(payload.code || socket.data.roomCode);
    if (!code || isPublicRoomCode(code)) {
      if (typeof ack === "function") ack({ ok: false, error: "Укажите номер комнаты" });
      return;
    }
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Комната не найдена" });
      return;
    }
    if (!canModerate(socket, room) && !isSuper(socket)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только владелец" });
      return;
    }
    if (!isSuper(socket)) {
      if (socket.data.roomCode !== code) {
        if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в комнату" });
        return;
      }
      const confirm = normalizePin(payload.confirmPin);
      const acc = store.accounts[socket.data.accountId];
      if (!acc || !confirm || hashPin(confirm) !== acc.pinHash) {
        if (typeof ack === "function") ack({ ok: false, error: "Подтвердите пином" });
        return;
      }
    }

    unlinkRoomImages(room);
    for (const [id, u] of online.entries()) {
      if (u.roomCode !== code) continue;
      const sock = io.sockets.sockets.get(id);
      if (!sock) continue;
      leaveRoom(sock);
      sock.emit("room:gone", { code, reason: "deleted" });
    }
    delete store.rooms[code];
    saveStore(store, { flush: true });
    if (typeof ack === "function") ack({ ok: true, deleted: true, code });
  });

  socket.on("chat:message", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const code = socket.data.roomCode;
    if (!code || !store.rooms[code]) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала выберите комнату" });
      return;
    }
    const room = store.rooms[code];
    const text = String(payload.text || "").trim().slice(0, MAX_TEXT_LEN);
    const imageUrl =
      typeof payload.imageUrl === "string" && payload.imageUrl.startsWith("/uploads/")
        ? payload.imageUrl.slice(0, 200)
        : "";
    if (!text && !imageUrl) {
      if (typeof ack === "function") ack({ ok: false, error: "Пустое сообщение" });
      return;
    }
    let replyTo = null;
    if (payload.replyTo && typeof payload.replyTo === "object") {
      replyTo = {
        id: String(payload.replyTo.id || "").slice(0, 40),
        name: String(payload.replyTo.name || "").slice(0, 24),
        text: String(payload.replyTo.text || "").slice(0, 120),
      };
    }
    const msg = {
      id: newMessageId(),
      name: user.isAdmin ? ADMIN_DISPLAY_NAME : user.name,
      text,
      imageUrl,
      createdAt: new Date().toISOString(),
      replyTo,
      reactions: {},
      admin: Boolean(user.isAdmin),
      roomAdmin: Boolean(!user.isAdmin && isOwner(socket, room)),
    };
    room.messages.push(msg);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages = room.messages.slice(-MAX_MESSAGES);
    }
    touchRoom(code);
    if (!user.isAdmin) rememberParticipant(code, user.name);
    saveStore(store);

    const view = messageView(msg);
    io.to(roomChannel(code)).emit("room:message", { code, message: view });
    if (typeof ack === "function") ack({ ok: true, message: view });

    const preview = text || "фото";
    const isPublic = isPublicRoomCode(code);
    const title = isPublic ? PUBLIC_CHAT_LABEL : `Комната ${code}`;
    for (const name of new Set(room.participants || [])) {
      if (nameKey(name) === nameKey(msg.name)) continue;
      void pushToName(
        name,
        { title, body: `${msg.name}: ${preview}`, roomCode: code, id: msg.id },
        { roomCode: code, isPublic }
      );
    }
  });

  socket.on("chat:react", (payload = {}, ack) => {
    const user = online.get(socket.id);
    const code = socket.data.roomCode;
    const room = code ? store.rooms[code] : null;
    if (!user || !room) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    const id = String(payload.id || "");
    const emoji = String(payload.emoji || "").slice(0, 8);
    if (!id || !emoji) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны id и emoji" });
      return;
    }
    const msg = room.messages.find((m) => m.id === id);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (!msg.reactions || typeof msg.reactions !== "object") msg.reactions = {};
    const list = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : [];
    const who = user.name;
    const idx = list.indexOf(who);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(who);
    if (list.length) msg.reactions[emoji] = list;
    else delete msg.reactions[emoji];
    saveStore(store);
    io.to(roomChannel(code)).emit("room:react", { code, id, reactions: msg.reactions });
    if (typeof ack === "function") ack({ ok: true, reactions: msg.reactions });
  });

  socket.on("chat:pin", (payload = {}, ack) => {
    const code = socket.data.roomCode;
    const room = code ? store.rooms[code] : null;
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    if (!canModerate(socket, room)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только владелец" });
      return;
    }
    const id = String(payload.id || "");
    const msg = room.messages.find((m) => m.id === id);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (!Array.isArray(room.pinnedIds)) room.pinnedIds = [];
    if (payload.pin === false) {
      room.pinnedIds = room.pinnedIds.filter((x) => x !== id);
    } else if (!room.pinnedIds.includes(id)) {
      room.pinnedIds.push(id);
      if (room.pinnedIds.length > 30) room.pinnedIds = room.pinnedIds.slice(-30);
    }
    saveStore(store);
    const snap = roomSnapshot(code);
    io.to(roomChannel(code)).emit("room:state", {
      code,
      messages: snap.messages,
      pinned: snap.pinned,
    });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("chat:delete", (payload = {}, ack) => {
    const code = socket.data.roomCode;
    const room = code ? store.rooms[code] : null;
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Не в комнате" });
      return;
    }
    if (!canModerate(socket, room)) {
      if (typeof ack === "function") ack({ ok: false, error: "Только владелец" });
      return;
    }
    const ids = Array.isArray(payload.ids)
      ? payload.ids.map(String)
      : payload.id
        ? [String(payload.id)]
        : [];
    if (!ids.length) {
      if (typeof ack === "function") ack({ ok: false, error: "Нет id" });
      return;
    }
    const set = new Set(ids);
    room.messages = room.messages.filter((m) => !set.has(m.id));
    room.pinnedIds = (room.pinnedIds || []).filter((id) => !set.has(id));
    saveStore(store);
    io.to(roomChannel(code)).emit("room:deleted", { code, ids });
    if (typeof ack === "function") ack({ ok: true, ids });
  });

  socket.on("disconnect", () => {
    const user = online.get(socket.id);
    const code = user?.roomCode || socket.data.roomCode;
    online.delete(socket.id);
    if (code) emitPresence(code);
    emitChatPresence();
  });
});

function shutdown() {
  flushStore(store);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => flushStore(store));

server.listen(PORT, () => {
  console.log(`Сарафан v2 on http://localhost:${PORT}`);
  console.log(
    `Admin password: ${ADMIN_PASSWORD === "change-me" ? "change-me (set ADMIN_PASSWORD)" : "(set via env)"}`
  );
});
