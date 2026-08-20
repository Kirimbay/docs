const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const helmet = require("helmet");
const sharp = require("sharp");

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const IMAGE_MAX_PX = Number(process.env.IMAGE_MAX_PX) || 1440;
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY) || 68;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const ADMIN_TOKENS_PATH = path.join(DATA_DIR, "admin-tokens.json");
const MAX_MESSAGES = 5000;
const MAX_NAME_LEN = 24;
const MAX_TEXT_LEN = 2000;
const MAX_ADMIN_TOKENS = 80;

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
      return data;
    }
  } catch (err) {
    console.error("Failed to load store:", err.message);
  }
  return { messages: [], pinnedIds: [], rooms: {} };
}

function saveStore(store) {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

let store = loadStore();

function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

const ADMIN_DISPLAY_NAME = "АДМИН";

function isReservedAdminName(name) {
  if (typeof name !== "string") return false;
  return name.replace(/\s+/g, "").toLocaleUpperCase("ru-RU") === ADMIN_DISPLAY_NAME;
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

function isNameTaken(name, exceptSocketId = null) {
  return findSocketIdsWithName(name, exceptSocketId).length > 0;
}

function uniqueRandomName() {
  const taken = new Set([...online.values()].map((u) => nameKey(u.name)));
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

function publicMessage(msg) {
  return {
    id: msg.id,
    name: msg.name,
    text: msg.text || "",
    imageUrl: msg.imageUrl || null,
    createdAt: msg.createdAt,
    pinned: store.pinnedIds.includes(msg.id),
    admin: Boolean(msg.admin),
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

function publicRoomMessage(msg) {
  return {
    id: msg.id,
    name: msg.name,
    text: msg.text || "",
    imageUrl: msg.imageUrl || null,
    createdAt: msg.createdAt,
    pinned: false,
    admin: Boolean(msg.admin),
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

function snapshot() {
  const pinned = store.pinnedIds
    .map((id) => store.messages.find((m) => m.id === id))
    .filter(Boolean)
    .map(publicMessage);
  const messages = store.messages.map(publicMessage);
  return { messages, pinned };
}

const ROOM_CODE_ALPHABET = "0123456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_MESSAGES = 2000;
const MAX_ROOM_MEMBERS = 2;

function ensureRooms() {
  if (!store.rooms || typeof store.rooms !== "object") store.rooms = {};
}

function generateRoomCode() {
  ensureRooms();
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!store.rooms[code]) return code;
  }
  // Extremely unlikely fallback: sequential-ish numeric from time
  for (let n = 0; n < 1000; n += 1) {
    const code = String((Date.now() + n) % 1e6).padStart(ROOM_CODE_LENGTH, "0");
    if (!store.rooms[code]) return code;
  }
  return String(Math.floor(Math.random() * 1e6)).padStart(ROOM_CODE_LENGTH, "0");
}

function normalizeRoomCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "").replace(/\D/g, "");
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return code;
}

function roomChannel(code) {
  return `dm:${code}`;
}

function roomOnlineCount(code) {
  const set = io.sockets.adapter.rooms.get(roomChannel(code));
  return set ? set.size : 0;
}

function roomMemberNames(code) {
  const names = [];
  for (const u of online.values()) {
    if (u.roomCode === code) names.push(u.name);
  }
  return names;
}

function roomSnapshot(code) {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return null;
  return {
    code,
    messages: (room.messages || []).map(publicRoomMessage),
    pinned: [],
  };
}

function roomPeerFor(code, exceptName = "") {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return "";
  const except = String(exceptName || "").trim();
  for (const u of online.values()) {
    if (u.roomCode === code && u.name && u.name !== except) return u.name;
  }
  const msgs = Array.isArray(room.messages) ? room.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const name = msgs[i]?.name;
    if (name && name !== except) return name;
  }
  if (room.createdBy && room.createdBy !== except) return room.createdBy;
  return "";
}

function roomListMeta(code, exceptName = "") {
  ensureRooms();
  const room = store.rooms[code];
  if (!room) return { code, exists: false, peer: "", messageCount: 0 };
  return {
    code,
    exists: true,
    peer: roomPeerFor(code, exceptName),
    messageCount: Array.isArray(room.messages) ? room.messages.length : 0,
  };
}

function emitDmPresence(code) {
  io.to(roomChannel(code)).emit("dm:presence", {
    code,
    count: roomOnlineCount(code),
    names: roomMemberNames(code),
  });
}

function presencePayload() {
  const people = [...online.entries()].map(([id, u]) => ({
    id,
    name: u.name,
  }));
  return {
    count: people.length,
    people,
    names: people.map((p) => p.name),
  };
}

function emitChatPresence() {
  io.emit("chat:presence", presencePayload());
}

function leaveDmRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.leave(roomChannel(code));
  socket.data.roomCode = null;
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
      .webp({ quality: IMAGE_QUALITY, effort: 4, smartSubsample: true })
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
    .jpeg({ quality: Math.min(82, IMAGE_QUALITY + 8), mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: jpeg.data, ext: ".jpg", mime: "image/jpeg" };
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

app.get("/api/random-name", (_req, res) => {
  res.json({ name: uniqueRandomName() });
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
    let custom = sanitizeName(payload.name);
    if (custom && isReservedAdminName(custom) && !asAdmin) {
      custom = null;
    }
    const prevFromClient = sanitizeName(payload.previousName);
    const previousName =
      prevFromClient && !isReservedAdminName(prevFromClient) ? prevFromClient : null;

    let name;
    if (asAdmin) {
      name = ADMIN_DISPLAY_NAME;
    } else if (custom) {
      name = custom;
    } else {
      name = uniqueRandomName();
    }

    // One connection per nick: replace older tab/device with the same name.
    claimName(name, socket.id);
    leaveDmRoom(socket);
    online.set(socket.id, {
      name,
      isAdmin: asAdmin,
      roomCode: null,
      previousName: asAdmin ? previousName : null,
    });
    socket.data.name = name;
    socket.data.isAdmin = asAdmin;
    socket.data.roomCode = null;
    socket.data.previousName = asAdmin ? previousName : null;
    emitChatPresence();
    // Fresh snapshot after join so the client can pin to latest once visible.
    socket.emit("chat:state", snapshot());
    if (typeof ack === "function") {
      ack({
        ok: true,
        name,
        admin: asAdmin,
        previousName: asAdmin ? previousName : null,
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
    if (isReservedAdminName(name)) {
      if (typeof ack === "function") ack({ ok: false, error: "Это имя зарезервировано" });
      return;
    }
    if (isNameTaken(name, socket.id)) {
      if (typeof ack === "function") ack({ ok: false, error: "Имя уже занято — выберите другое" });
      return;
    }
    user.name = name;
    socket.data.name = name;
    emitChatPresence();
    if (user.roomCode) emitDmPresence(user.roomCode);
    if (typeof ack === "function") ack({ ok: true, name });
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
    if (!restore || isReservedAdminName(restore) || isNameTaken(restore, socket.id)) {
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

  socket.on("dm:create", (_payload, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    leaveDmRoom(socket);
    ensureRooms();
    const code = generateRoomCode();
    store.rooms[code] = {
      code,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      messages: [],
    };
    saveStore(store);
    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    user.roomCode = code;
    const snap = roomSnapshot(code);
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        messages: snap.messages,
        pinned: [],
        count: 1,
        names: [user.name],
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
    leaveDmRoom(socket);
    ensureRooms();
    const code = generateRoomCode();
    store.rooms[code] = {
      code,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      messages: [],
    };
    saveStore(store);
    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    user.roomCode = code;
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
        messages: snap.messages,
        pinned: [],
        count: roomOnlineCount(code),
        names: roomMemberNames(code),
        invited: target.name,
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
    const raw = Array.isArray(payload.codes) ? payload.codes : [];
    const codes = [];
    const seen = new Set();
    for (const item of raw) {
      const code = normalizeRoomCode(item);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
      if (codes.length >= 24) break;
    }
    if (typeof ack === "function") {
      ack({
        ok: true,
        rooms: codes.map((code) => roomListMeta(code, user.name)),
      });
    }
  });

  socket.on("dm:join", (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите" });
      return;
    }
    const code = normalizeRoomCode(payload.code);
    if (!code) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужен код из 6 цифр" });
      return;
    }
    ensureRooms();
    const room = store.rooms[code];
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Чат не найден — проверьте код" });
      return;
    }
    if (socket.data.roomCode === code) {
      const snap = roomSnapshot(code);
      if (typeof ack === "function") {
        ack({
          ok: true,
          code,
          messages: snap.messages,
          pinned: [],
          count: roomOnlineCount(code),
          names: roomMemberNames(code),
        });
      }
      return;
    }
    leaveDmRoom(socket);
    if (roomOnlineCount(code) >= MAX_ROOM_MEMBERS) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Уже двое в чате. Зайдите, когда кто-то выйдет." });
      }
      return;
    }
    socket.join(roomChannel(code));
    socket.data.roomCode = code;
    user.roomCode = code;
    const snap = roomSnapshot(code);
    if (typeof ack === "function") {
      ack({
        ok: true,
        code,
        messages: snap.messages,
        pinned: [],
        count: roomOnlineCount(code),
        names: roomMemberNames(code),
      });
    }
    emitDmPresence(code);
  });

  socket.on("dm:leave", (_payload, ack) => {
    const code = socket.data.roomCode;
    leaveDmRoom(socket);
    if (typeof ack === "function") ack({ ok: true, code: code || null });
    socket.emit("chat:state", snapshot());
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
    const messageList = roomCode
      ? (ensureRooms(), store.rooms[roomCode] ? store.rooms[roomCode].messages : null)
      : store.messages;
    if (roomCode && !messageList) {
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

    const msg = {
      id: randomUUID(),
      name: user.isAdmin || socket.data.isAdmin ? ADMIN_DISPLAY_NAME : user.name,
      text,
      imageUrl,
      reply,
      reactions: {},
      admin: Boolean(user.isAdmin || socket.data.isAdmin),
      createdAt: new Date().toISOString(),
    };
    messageList.push(msg);
    const maxLen = roomCode ? MAX_ROOM_MESSAGES : MAX_MESSAGES;
    if (messageList.length > maxLen) {
      const removed = messageList.splice(0, messageList.length - maxLen);
      if (!roomCode) {
        const keep = new Set(store.messages.map((m) => m.id));
        store.pinnedIds = store.pinnedIds.filter((id) => keep.has(id));
      }
      for (const old of removed) {
        if (old.imageUrl && (roomCode || !store.pinnedIds.includes(old.id))) {
          const file = path.join(UPLOAD_DIR, path.basename(old.imageUrl));
          fs.promises.unlink(file).catch(() => {});
        }
      }
    }
    saveStore(store);
    if (roomCode) {
      const pub = publicRoomMessage(msg);
      io.to(roomChannel(roomCode)).emit("dm:message", pub);
      if (typeof ack === "function") ack({ ok: true, id: msg.id });
      return;
    }
    const pub = publicMessage(msg);
    io.emit("chat:message", pub);
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
    let msg = null;
    if (roomCode) {
      ensureRooms();
      msg = store.rooms[roomCode]?.messages?.find((m) => m.id === id) || null;
    } else {
      msg = store.messages.find((m) => m.id === id) || null;
    }
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
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
    if (roomCode) {
      const pub = publicRoomMessage(msg);
      io.to(roomChannel(roomCode)).emit("dm:message-update", pub);
      if (typeof ack === "function") ack({ ok: true, message: pub, added });
      return;
    }
    const pub = publicMessage(msg);
    io.emit("chat:message-update", pub);
    if (typeof ack === "function") ack({ ok: true, message: pub, added });
  });

  socket.on("admin:pin", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const id = payload.id;
    const msg = store.messages.find((m) => m.id === id);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (!store.pinnedIds.includes(id)) {
      store.pinnedIds.unshift(id);
      store.pinnedIds = store.pinnedIds.slice(0, 20);
      saveStore(store);
    }
    io.emit("chat:state", snapshot());
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:unpin", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    store.pinnedIds = store.pinnedIds.filter((id) => id !== payload.id);
    saveStore(store);
    io.emit("chat:state", snapshot());
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:delete", (payload = {}, ack) => {
    if (!socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const roomCode = socket.data.roomCode || null;
    if (roomCode) {
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
      saveStore(store);
      if (removed.imageUrl) {
        const file = path.join(UPLOAD_DIR, path.basename(removed.imageUrl));
        fs.promises.unlink(file).catch(() => {});
      }
      io.to(roomChannel(roomCode)).emit("chat:message-removed", { id: removed.id });
      if (typeof ack === "function") ack({ ok: true, id: removed.id });
      return;
    }
    const idx = store.messages.findIndex((m) => m.id === payload.id);
    if (idx === -1) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    const [removed] = store.messages.splice(idx, 1);
    store.pinnedIds = store.pinnedIds.filter((id) => id !== payload.id);
    saveStore(store);
    if (removed.imageUrl) {
      const file = path.join(UPLOAD_DIR, path.basename(removed.imageUrl));
      fs.promises.unlink(file).catch(() => {});
    }
    io.emit("chat:message-removed", { id: removed.id });
    io.emit("chat:state", snapshot());
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
});
