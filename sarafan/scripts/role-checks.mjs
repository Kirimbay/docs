/**
 * Role smoke checks for Сарафан v2
 * Usage: ADMIN_PASSWORD=... node scripts/role-checks.mjs [baseUrl]
 */
import { io } from "socket.io-client";
import { randomBytes } from "crypto";

const BASE = process.argv[2] || process.env.CHAT_URL || "http://127.0.0.1:3847";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

const clientId = () => randomBytes(12).toString("base64url");
const connect = () =>
  io(BASE, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 8000 });

function ready(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function emit(socket, event, payload = {}, ms = 10000) {
  return new Promise((resolve, reject) => {
    socket.timeout(ms).emit(event, payload, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function joinAs(name, pin) {
  const socket = connect();
  await ready(socket);
  const res = await emit(socket, "chat:join", { name, pin, clientId: clientId() });
  assert(res?.ok, res?.error || `join ${name}`);
  return { socket, name: res.name };
}

async function joinSuper() {
  const socket = connect();
  await ready(socket);
  const nick = `Probe${Math.floor(Math.random() * 900 + 100)}`;
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const gate = await emit(socket, "chat:join", { name: nick, pin, clientId: clientId() });
  assert(gate?.ok, gate?.error || "super gate");
  const admin = await emit(socket, "admin:login", { password: ADMIN_PASSWORD });
  assert(admin?.ok, admin?.error || "admin:login");
  return { socket, token: admin.token, nick, pin };
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

const t = Date.now().toString().slice(-4);

await check("1. Юзер: создать открытую и писать", async () => {
  const a = await joinAs(`Ua${t}`, "1111");
  const created = await emit(a.socket, "room:create", { joinKey: "" });
  assert(created?.ok && created.isOwner, created?.error || "create");
  const msg = await emit(a.socket, "chat:message", { text: "привет" });
  assert(msg?.ok, msg?.error || "message");
  a.socket.close();
});

await check("2. Юзер: войти в чужую открытую", async () => {
  const owner = await joinAs(`Ub${t}`, "2222");
  const created = await emit(owner.socket, "room:create", { joinKey: "" });
  assert(created?.ok, created?.error || "create");
  const guest = await joinAs(`Uc${t}`, "3333");
  const joined = await emit(guest.socket, "room:join", { code: created.code });
  assert(joined?.ok && !joined.isOwner, joined?.error || "join");
  const msg = await emit(guest.socket, "chat:message", { text: "гость" });
  assert(msg?.ok, msg?.error || "msg");
  owner.socket.close();
  guest.socket.close();
});

await check("3. Владелец: keyed + смена ключа + модерация", async () => {
  const owner = await joinAs(`Ud${t}`, "4444");
  const created = await emit(owner.socket, "room:create", { joinKey: "9876" });
  assert(created?.ok && created.keyed, created?.error || "create keyed");
  const code = created.code;
  const msg = await emit(owner.socket, "chat:message", { text: "пин" });
  assert(msg?.ok, msg?.error || "msg");
  const pinned = await emit(owner.socket, "chat:pin", { id: msg.message.id, pin: true });
  assert(pinned?.ok, pinned?.error || "pin");
  const changed = await emit(owner.socket, "room:set-access", {
    access: "keyed",
    joinKey: "5555",
    confirmPin: "4444",
  });
  assert(changed?.ok && changed.keyed, changed?.error || "set-access");
  const stranger = await joinAs(`Ue${t}`, "6666");
  const bad = await emit(stranger.socket, "room:join", { code });
  assert(!bad?.ok && bad?.needsKey, "should need key");
  const good = await emit(stranger.socket, "room:join", { code, key: "5555" });
  assert(good?.ok && !good.isOwner, good?.error || "join keyed");
  owner.socket.close();
  stranger.socket.close();
});

await check("4. Супер-админ: create после token-resume + delete", async () => {
  const superA = await joinSuper();
  superA.socket.close();
  const s2 = connect();
  await ready(s2);
  const resume = await emit(s2, "chat:join", {
    name: superA.nick,
    clientId: clientId(),
    adminToken: superA.token,
    previousName: superA.nick,
  });
  assert(resume?.ok && resume.admin, resume?.error || "resume");
  const created = await emit(s2, "room:create", { joinKey: "1212" });
  assert(created?.ok, created?.error || "super create");
  const owner = await joinAs(`Uf${t}`, "7777");
  const other = await emit(owner.socket, "room:create", { joinKey: "" });
  assert(other?.ok, other?.error || "other create");
  const del = await emit(s2, "room:delete", { code: other.code });
  assert(del?.ok, del?.error || "super delete");
  const gone = await emit(owner.socket, "room:join", { code: other.code });
  assert(!gone?.ok, "deleted room must be gone");
  s2.close();
  owner.socket.close();
});

await check("5. Реконнект с пином и возврат в комнату", async () => {
  const pin = "8888";
  const name = `Ug${t}`;
  const cid = clientId();
  const s1 = connect();
  await ready(s1);
  const j1 = await emit(s1, "chat:join", { name, pin, clientId: cid });
  assert(j1?.ok, j1?.error || "join");
  const created = await emit(s1, "room:create", { joinKey: "" });
  assert(created?.ok, created?.error || "create");
  const code = created.code;
  s1.close();
  const s2 = connect();
  await ready(s2);
  const j2 = await emit(s2, "chat:join", { name, pin, clientId: cid });
  assert(j2?.ok, j2?.error || "rejoin");
  const r2 = await emit(s2, "room:join", { code });
  assert(r2?.ok && r2.isOwner, r2?.error || "room rejoin");
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
