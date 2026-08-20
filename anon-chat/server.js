const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const helmet = require("helmet");
const webpush = require("web-push");

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MAX_MESSAGES = 5000;
const MAX_NAME_LEN = 24;
const MAX_TEXT_LEN = 2000;

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

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    }
  } catch (err) {
    console.error("Failed to load store:", err.message);
  }
  return { messages: [], pinnedIds: [] };
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

function sanitizeName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
  if (!name) return null;
  return name;
}

function sanitizeText(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_TEXT_LEN);
}

const REACTION_EMOJIS = ["😊", "❤️", "😢", "💩", "🔥"];
const VAPID_PATH = path.join(DATA_DIR, "vapid.json");
const PUSH_SUBS_PATH = path.join(DATA_DIR, "push-subs.json");
const PING_COOLDOWN_MS = 45_000;
let lastPingAllAt = 0;

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
    subject: process.env.VAPID_SUBJECT || "mailto:admin@sarafan.local",
  };
  try {
    fs.writeFileSync(VAPID_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("Failed to save VAPID keys:", err.message);
  }
  return payload;
}

const vapid = loadOrCreateVapid();
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

/** @type {{endpoint:string,keys:object,name:string,updatedAt:string}[]} */
let pushSubs = loadPushSubs();

function upsertPushSub(subscription, name) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { ok: false, error: "Некорректная подписка" };
  }
  const nick = sanitizeName(name) || "";
  const now = new Date().toISOString();
  const idx = pushSubs.findIndex((s) => s.endpoint === subscription.endpoint);
  const row = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    name: nick,
    updatedAt: now,
  };
  if (idx >= 0) pushSubs[idx] = row;
  else pushSubs.push(row);
  // Keep newest 2000 subscriptions.
  if (pushSubs.length > 2000) {
    pushSubs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    pushSubs = pushSubs.slice(0, 2000);
  }
  savePushSubs(pushSubs);
  return { ok: true };
}

function removePushSub(endpoint) {
  const before = pushSubs.length;
  pushSubs = pushSubs.filter((s) => s.endpoint !== endpoint);
  if (pushSubs.length !== before) savePushSubs(pushSubs);
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

async function pushToName(name, payload) {
  if (!name) return 0;
  const targets = pushSubs.filter((s) => s.name === name);
  const results = await Promise.all(targets.map((s) => sendWebPush(s, payload)));
  return results.filter(Boolean).length;
}

async function pushToAll(payload) {
  const results = await Promise.all(pushSubs.map((s) => sendWebPush(s, payload)));
  return results.filter(Boolean).length;
}

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
      ? ext
      : ".jpg";
    cb(null, `${Date.now()}-${randomUUID()}${safeExt}`);
  },
});

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
  const result = upsertPushSub(subscription, name);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

app.post("/api/push-unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === "string" && endpoint) removePushSub(endpoint);
  res.json({ ok: true });
});

app.get("/api/random-name", (_req, res) => {
  res.json({ name: randomName() });
});

app.post("/api/upload", (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `Файл больше ${MAX_UPLOAD_MB} МБ`
          : err.message || "Ошибка загрузки";
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Файл не получен" });
    }
    res.json({ imageUrl: `/uploads/${req.file.filename}` });
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
    const custom = sanitizeName(payload.name);
    const name = custom || randomName();
    online.set(socket.id, { name, isAdmin: false });
    socket.data.name = name;
    socket.data.isAdmin = false;
    io.emit("chat:presence", {
      count: online.size,
      names: [...online.values()].map((u) => u.name),
    });
    if (typeof ack === "function") ack({ ok: true, name });
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
    user.name = name;
    socket.data.name = name;
    io.emit("chat:presence", {
      count: online.size,
      names: [...online.values()].map((u) => u.name),
    });
    if (typeof ack === "function") ack({ ok: true, name });
  });

  socket.on("admin:login", (payload = {}, ack) => {
    const password = typeof payload.password === "string" ? payload.password : "";
    const user = online.get(socket.id);
    if (!user) {
      if (typeof ack === "function") ack({ ok: false, error: "Сначала войдите в чат" });
      return;
    }
    if (password !== ADMIN_PASSWORD) {
      if (typeof ack === "function") ack({ ok: false, error: "Неверный пароль" });
      return;
    }
    user.isAdmin = true;
    socket.data.isAdmin = true;
    if (typeof ack === "function") ack({ ok: true });
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

    let reply = null;
    const replyId = typeof payload.replyToId === "string" ? payload.replyToId : "";
    if (replyId) {
      const target = store.messages.find((m) => m.id === replyId);
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
      name: user.name,
      text,
      imageUrl,
      reply,
      reactions: {},
      createdAt: new Date().toISOString(),
    };
    store.messages.push(msg);
    if (store.messages.length > MAX_MESSAGES) {
      const removed = store.messages.splice(0, store.messages.length - MAX_MESSAGES);
      const keep = new Set(store.messages.map((m) => m.id));
      store.pinnedIds = store.pinnedIds.filter((id) => keep.has(id));
      for (const old of removed) {
        if (old.imageUrl && !store.pinnedIds.includes(old.id)) {
          const file = path.join(UPLOAD_DIR, path.basename(old.imageUrl));
          fs.promises.unlink(file).catch(() => {});
        }
      }
    }
    saveStore(store);
    const pub = publicMessage(msg);
    io.emit("chat:message", pub);
    if (msg.reply && msg.reply.name && msg.reply.name !== msg.name) {
      for (const [sid, u] of online.entries()) {
        if (u.name === msg.reply.name) {
          io.to(sid).emit("chat:reply-notify", pub);
        }
      }
      void pushToName(msg.reply.name, {
        title: `${msg.name} ответил вам`,
        body: (msg.text || (msg.imageUrl ? "Фото" : "Сообщение")).slice(0, 120),
        tag: `sarafan-reply-${msg.id}`,
        id: msg.id,
        url: "/",
      });
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
    const msg = store.messages.find((m) => m.id === id);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Сообщение не найдено" });
      return;
    }
    if (!msg.reactions || typeof msg.reactions !== "object") msg.reactions = {};
    const list = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : [];
    const idx = list.indexOf(user.name);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(user.name);
    if (list.length) msg.reactions[emoji] = list;
    else delete msg.reactions[emoji];
    msg.reactions = normalizeReactions(msg.reactions);
    saveStore(store);
    const pub = publicMessage(msg);
    io.emit("chat:message-update", pub);
    if (typeof ack === "function") ack({ ok: true, message: pub });
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
    io.emit("chat:state", snapshot());
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:ping-all", async (payload = {}, ack) => {
    const user = online.get(socket.id);
    if (!user?.isAdmin && !socket.data.isAdmin) {
      if (typeof ack === "function") ack({ ok: false, error: "Нужны права админа" });
      return;
    }
    const now = Date.now();
    if (now - lastPingAllAt < PING_COOLDOWN_MS) {
      const wait = Math.ceil((PING_COOLDOWN_MS - (now - lastPingAllAt)) / 1000);
      if (typeof ack === "function") ack({ ok: false, error: `Подождите ${wait} с` });
      return;
    }
    lastPingAllAt = now;
    const custom =
      typeof payload.text === "string" ? payload.text.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const body = custom || "Заходите в Сарафан — вас ждут в чате";
    const sent = await pushToAll({
      title: "Сарафан",
      body,
      tag: "sarafan-ping-all",
      id: null,
      url: "/",
      ping: true,
    });
    io.emit("chat:admin-ping", { body, at: new Date().toISOString() });
    if (typeof ack === "function") ack({ ok: true, sent, subscribers: pushSubs.length });
  });

  socket.on("disconnect", () => {
    online.delete(socket.id);
    io.emit("chat:presence", {
      count: online.size,
      names: [...online.values()].map((u) => u.name),
    });
  });
});

server.listen(PORT, () => {
  console.log(`Сарафан listening on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === "change-me" ? "change-me (set ADMIN_PASSWORD)" : "(set via env)"}`);
});
