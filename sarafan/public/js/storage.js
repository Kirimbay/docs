const PREFIX = "sarafan.v2.";

export function load(key, fallback = "") {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, String(value));
  } catch {
    /* ignore */
  }
}

export function loadJson(key, fallback) {
  try {
    const raw = load(key, "");
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    save(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function clientId() {
  let id = load("clientId");
  if (!id || id.length < 8) {
    id = crypto.randomUUID?.() || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    save("clientId", id);
  }
  return id;
}

export function normalizePin(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 4);
}

export function normalizeCode(raw) {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 6);
  if (!d) return "";
  return d.padStart(6, "0").slice(-6);
}

const ROOMS_KEY = "rooms";

export function loadRooms() {
  const list = loadJson(ROOMS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveRooms(list) {
  saveJson(ROOMS_KEY, Array.isArray(list) ? list.slice(-40) : []);
}

export function rememberRoom(code, patch = {}) {
  const c = normalizeCode(code);
  if (c.length !== 6) return;
  const rooms = loadRooms().filter((r) => r.code !== c);
  rooms.unshift({
    code: c,
    messageCount: 0,
    unread: 0,
    keyed: false,
    ...patch,
    updatedAt: Date.now(),
  });
  saveRooms(rooms);
}

export function forgetRoom(code) {
  const c = normalizeCode(code);
  saveRooms(loadRooms().filter((r) => r.code !== c));
}

export function loadRoomKey(code) {
  return normalizePin(load(`key.${normalizeCode(code)}`));
}

export function saveRoomKey(code, key) {
  const k = normalizePin(key);
  save(`key.${normalizeCode(code)}`, k.length === 4 ? k : "");
}
