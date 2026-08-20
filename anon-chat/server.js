const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const helmet = require("helmet");

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MAX_MESSAGES = 5000;
const MAX_NAME_LEN = 24;
const MAX_TEXT_LEN = 2000;

const ADJECTIVES = [
  "Тихий",
  "Быстрый",
  "Смелый",
  "Яркий",
  "Лёгкий",
  "Ночной",
  "Тёплый",
  "Северный",
  "Рыжий",
  "Мягкий",
  "Острый",
  "Дальний",
];
const NOUNS = [
  "Барс",
  "Кит",
  "Ветер",
  "Клен",
  "Лис",
  "Камень",
  "Ручей",
  "Сокол",
  "Мох",
  "Огонь",
  "Туман",
  "Ясень",
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
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${a} ${n}${num}`;
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
      if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.get("/api/health", (_req, res) => {
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
    io.emit("chat:message", publicMessage(msg));
    if (typeof ack === "function") ack({ ok: true, id: msg.id });
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

  socket.on("disconnect", () => {
    online.delete(socket.id);
    io.emit("chat:presence", {
      count: online.size,
      names: [...online.values()].map((u) => u.name),
    });
  });
});

server.listen(PORT, () => {
  console.log(`Комната listening on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === "change-me" ? "change-me (set ADMIN_PASSWORD)" : "(set via env)"}`);
});
