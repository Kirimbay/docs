const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyStore() {
  return { accounts: {}, rooms: {}, version: 2 };
}

function loadStore() {
  ensureDataDir();
  try {
    if (!fs.existsSync(STORE_PATH)) return emptyStore();
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data.accounts || typeof data.accounts !== "object") data.accounts = {};
    if (!data.rooms || typeof data.rooms !== "object") data.rooms = {};
    data.version = 2;
    return data;
  } catch (err) {
    console.error("store load failed:", err.message);
    return emptyStore();
  }
}

let saveTimer = null;
let dirty = false;

function writeSync(store) {
  ensureDataDir();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE_PATH);
}

function saveStore(store, { flush = false } = {}) {
  dirty = true;
  if (flush) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    dirty = false;
    writeSync(store);
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      writeSync(store);
    } catch (err) {
      console.error("store save failed:", err.message);
    }
  }, 200);
}

function flushStore(store) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    writeSync(store);
  } catch (err) {
    console.error("store flush failed:", err.message);
  }
}

module.exports = {
  DATA_DIR,
  STORE_PATH,
  loadStore,
  saveStore,
  flushStore,
  ensureDataDir,
};
