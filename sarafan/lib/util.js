const { createHash, randomBytes, randomUUID } = require("crypto");

const MAX_NAME_LEN = 24;
const PUBLIC_ROOM_CODE = "000000";
const PUBLIC_CHAT_LABEL = "Сарафан ВПН";
const ADMIN_DISPLAY_NAME = "АДМИН";

const NAMES = [
  "Барс", "Кит", "Лис", "Рысь", "Сокол", "Тигр", "Олень", "Волк",
  "Енот", "Норка", "Ирбис", "Кайман", "Феникс", "Комета", "Буран", "Янтарь",
];

function hashPin(pin) {
  const p = normalizePin(pin);
  if (!p) return "";
  return createHash("sha256").update(`sarafan:v2:${p}`).digest("hex");
}

function normalizePin(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 4);
  return digits.length === 4 ? digits : "";
}

function normalizeRoomCode(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 6);
  if (!digits) return "";
  return digits.padStart(6, "0").slice(-6);
}

function sanitizeName(raw) {
  const name = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
  return name;
}

function nameKey(name) {
  return sanitizeName(name).toLowerCase();
}

function isReservedAdminName(name) {
  return nameKey(name) === nameKey(ADMIN_DISPLAY_NAME);
}

function isPublicRoomCode(code) {
  return normalizeRoomCode(code) === PUBLIC_ROOM_CODE;
}

function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)] || "Гость";
}

function newClientId() {
  return randomBytes(12).toString("base64url");
}

function newAccountId() {
  return randomUUID();
}

function newMessageId() {
  return randomBytes(10).toString("hex");
}

function generateRoomCode(rooms) {
  for (let i = 0; i < 40; i += 1) {
    const code = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    if (code === PUBLIC_ROOM_CODE) continue;
    if (!rooms[code]) return code;
  }
  return "";
}

module.exports = {
  MAX_NAME_LEN,
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
  newClientId,
  newAccountId,
  newMessageId,
  generateRoomCode,
};
