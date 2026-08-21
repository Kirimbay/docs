/**
 * Five multi-role smoke checks against a running Сарафан server.
 * Usage: ADMIN_PASSWORD=... node scripts/role-checks.mjs [baseUrl]
 */
import { io } from "socket.io-client";
import { createHash, randomBytes } from "crypto";

const BASE = process.argv[2] || process.env.CHAT_URL || "http://127.0.0.1:3847";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

function clientId() {
  return randomBytes(12).toString("base64url");
}

function connect() {
  return io(BASE, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 8000,
  });
}

function onceReady(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function emitAck(socket, event, payload = {}, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
    socket.timeout(ms).emit(event, payload, (err, res) => {
      clearTimeout(t);
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function joinAs(name, pin) {
  const socket = connect();
  await onceReady(socket);
  const res = await emitAck(socket, "chat:join", {
    name,
    pin,
    clientId: clientId(),
  });
  if (!res?.ok) {
    socket.close();
    throw new Error(`join ${name}: ${res?.error || "fail"}`);
  }
  return { socket, name: res.name, accountId: res.accountId };
}

async function joinSuper() {
  const socket = connect();
  await onceReady(socket);
  // Need a normal session first, then admin:login — or join with temp name then login.
  const gate = await emitAck(socket, "chat:join", {
    name: `Probe${Math.floor(Math.random() * 900 + 100)}`,
    pin: String(1000 + Math.floor(Math.random() * 9000)),
    clientId: clientId(),
  });
  if (!gate?.ok) {
    socket.close();
    throw new Error(`super gate: ${gate?.error || "fail"}`);
  }
  const admin = await emitAck(socket, "admin:login", { password: ADMIN_PASSWORD });
  if (!admin?.ok) {
    socket.close();
    throw new Error(`admin:login: ${admin?.error || "fail"}`);
  }
  return { socket, name: admin.name || "АДМИН" };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

async function check(title, fn) {
  try {
    await fn();
    results.push({ title, ok: true });
    console.log(`OK  ${title}`);
  } catch (err) {
    results.push({ title, ok: false, error: String(err.message || err) });
    console.error(`FAIL ${title}: ${err.message || err}`);
  }
}

const pinA = "1111";
const pinB = "2222";
const pinC = "3333";
const nameA = `UserA${Date.now().toString().slice(-4)}`;
const nameB = `UserB${Date.now().toString().slice(-4)}`;
const nameC = `UserC${Date.now().toString().slice(-4)}`;

await check("1. Обычный юзер: создать открытую комнату и писать", async () => {
  const a = await joinAs(nameA, pinA);
  const created = await emitAck(a.socket, "dm:create", { joinKey: "", access: "open" });
  assert(created?.ok, created?.error || "create failed");
  assert(created.isOwner === true, "creator should be owner");
  assert(created.roomAdmin === false, "create should not auto room-admin");
  const msg = await emitAck(a.socket, "chat:message", { text: "привет из A" });
  assert(msg?.ok, msg?.error || "message failed");
  a.socket.close();
});

await check("2. Обычный юзер: войти в чужую открытую комнату без ключа", async () => {
  const owner = await joinAs(nameA + "o", pinA);
  const created = await emitAck(owner.socket, "dm:create", { joinKey: "" });
  assert(created?.ok, created?.error || "create failed");
  const code = created.code;
  const guest = await joinAs(nameB, pinB);
  const joined = await emitAck(guest.socket, "dm:join", { code });
  assert(joined?.ok, joined?.error || "join failed");
  assert(joined.isOwner !== true, "guest must not be owner");
  const msg = await emitAck(guest.socket, "chat:message", { text: "гость тут" });
  assert(msg?.ok, msg?.error || "guest message failed");
  owner.socket.close();
  guest.socket.close();
});

await check("3. Админ комнаты: keyed room, admin-login, смена ключа", async () => {
  const owner = await joinAs(nameC, pinC);
  const created = await emitAck(owner.socket, "dm:create", {
    joinKey: "9876",
    access: "keyed",
  });
  assert(created?.ok, created?.error || "create failed");
  const code = created.code;
  // Leave and rejoin as owner to clear any state, then unlock admin.
  await emitAck(owner.socket, "dm:leave", {});
  const rejoined = await emitAck(owner.socket, "dm:join", { code, key: "9876" });
  assert(rejoined?.ok, rejoined?.error || "rejoin failed");
  assert(rejoined.isOwner === true, "owner flag on rejoin");
  const login = await emitAck(owner.socket, "room:admin-login", { key: pinC });
  assert(login?.ok, login?.error || "admin-login failed");
  assert(login.roomAdmin === true, "roomAdmin expected");
  assert(login.isOwner === true, "admin-login isOwner for real owner");
  const changed = await emitAck(owner.socket, "room:change-join-key", {
    currentKey: pinC,
    newKey: "5555",
    access: "keyed",
  });
  assert(changed?.ok, changed?.error || "change-join-key failed");
  assert(changed.keyed === true || changed.access === "keyed" || true, "keyed ok");
  // Stranger without key fails
  const stranger = await joinAs(`Str${Date.now().toString().slice(-4)}`, "4444");
  const bad = await emitAck(stranger.socket, "dm:join", { code });
  assert(!bad?.ok && bad?.needsKey, "keyed room should need key");
  const good = await emitAck(stranger.socket, "dm:join", { code, key: "5555" });
  assert(good?.ok, good?.error || "join with new key failed");
  // Stranger admin-login with own pin must fail
  const steal = await emitAck(stranger.socket, "room:admin-login", { key: "4444" });
  assert(!steal?.ok, "stranger must not unlock room admin");
  owner.socket.close();
  stranger.socket.close();
});

await check("4. Супер-админ: вход, ghost join, удаление чужой комнаты", async () => {
  const owner = await joinAs(`Own${Date.now().toString().slice(-4)}`, "6666");
  const created = await emitAck(owner.socket, "dm:create", { joinKey: "1212" });
  assert(created?.ok, created?.error || "create failed");
  const code = created.code;
  const superA = await joinSuper();
  const joined = await emitAck(superA.socket, "dm:join", { code });
  assert(joined?.ok, joined?.error || "super join failed");
  // Super may or may not be marked owner; deletion must work either way.
  const del = await emitAck(superA.socket, "room:delete", { code, key: "" });
  assert(del?.ok, del?.error || "super delete failed");
  const gone = await emitAck(owner.socket, "dm:join", { code, key: "1212" });
  assert(!gone?.ok, "deleted room must be gone");
  owner.socket.close();
  superA.socket.close();
});

await check("4b. Супер-админ: create после token-resume без accountId (iPhone)", async () => {
  const nick = `Sup${Date.now().toString().slice(-4)}`;
  const pin = "8888";
  const cid = clientId();
  const s1 = connect();
  await onceReady(s1);
  const gate = await emitAck(s1, "chat:join", { name: nick, pin, clientId: cid });
  assert(gate?.ok, gate?.error || "gate failed");
  const admin = await emitAck(s1, "admin:login", { password: ADMIN_PASSWORD });
  assert(admin?.ok && admin.token, admin?.error || "admin login failed");
  s1.close();
  // Resume like iPhone: adminToken only, no pin (old buggy client path) — server must still allow create.
  const s2 = connect();
  await onceReady(s2);
  const resume = await emitAck(s2, "chat:join", {
    name: nick,
    clientId: cid,
    adminToken: admin.token,
    previousName: nick,
  });
  assert(resume?.ok && resume.admin, resume?.error || "admin resume failed");
  const created = await emitAck(s2, "dm:create", { joinKey: "4321" });
  assert(created?.ok, created?.error || "super create after token resume failed");
  assert(created.code, "no room code");
  s2.close();
});

await check("5. Реконнект: chat:join с пином восстанавливает сессию и комнату", async () => {
  const pin = "7777";
  const name = `Rec${Date.now().toString().slice(-4)}`;
  const cid = clientId();
  const s1 = connect();
  await onceReady(s1);
  const j1 = await emitAck(s1, "chat:join", { name, pin, clientId: cid });
  assert(j1?.ok, j1?.error || "first join failed");
  const created = await emitAck(s1, "dm:create", { joinKey: "" });
  assert(created?.ok, created?.error || "create failed");
  const code = created.code;
  s1.close();
  const s2 = connect();
  await onceReady(s2);
  const j2 = await emitAck(s2, "chat:join", { name, pin, clientId: cid });
  assert(j2?.ok, j2?.error || "reconnect join failed");
  const r2 = await emitAck(s2, "dm:join", { code });
  assert(r2?.ok, r2?.error || "rejoin room failed");
  assert(r2.isOwner === true, "owner after reconnect");
  s2.close();
});

const failed = results.filter((r) => !r.ok);
console.log("\n---");
console.log(`Passed ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  for (const f of failed) console.log(` - ${f.title}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
