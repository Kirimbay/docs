const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { ensureDataDir, DATA_DIR } = require("./store");

const VAPID_PATH = path.join(DATA_DIR, "vapid.json");
const PUSH_SUBS_PATH = path.join(DATA_DIR, "push-subs.json");

function loadOrCreateVapid() {
  ensureDataDir();
  try {
    if (fs.existsSync(VAPID_PATH)) {
      return JSON.parse(fs.readFileSync(VAPID_PATH, "utf8"));
    }
  } catch (err) {
    console.error("vapid load:", err.message);
  }
  const keys = webpush.generateVAPIDKeys();
  const vapid = {
    subject: process.env.VAPID_SUBJECT || "mailto:admin@chat.one.vele.uk",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
  fs.writeFileSync(VAPID_PATH, JSON.stringify(vapid, null, 2));
  return vapid;
}

const vapid = loadOrCreateVapid();
webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

function loadPushSubs() {
  try {
    if (!fs.existsSync(PUSH_SUBS_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(PUSH_SUBS_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let pushSubs = loadPushSubs();

function savePushSubs() {
  ensureDataDir();
  const tmp = `${PUSH_SUBS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pushSubs));
  fs.renameSync(tmp, PUSH_SUBS_PATH);
}

function upsertPushSub({ subscription, name, clientId, channels }) {
  if (!subscription?.endpoint || !subscription?.keys) return false;
  const row = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    name: String(name || ""),
    clientId: String(clientId || ""),
    channels: {
      public: channels?.public !== false,
      rooms: channels?.rooms !== false,
    },
    updatedAt: new Date().toISOString(),
  };
  const idx = pushSubs.findIndex((s) => s.endpoint === row.endpoint);
  if (idx >= 0) pushSubs[idx] = { ...pushSubs[idx], ...row };
  else pushSubs.push(row);
  if (pushSubs.length > 2000) {
    pushSubs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    pushSubs = pushSubs.slice(0, 2000);
  }
  savePushSubs();
  return true;
}

function removePushSub(endpoint) {
  const before = pushSubs.length;
  pushSubs = pushSubs.filter((s) => s.endpoint !== endpoint);
  if (pushSubs.length !== before) savePushSubs();
}

async function sendOne(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 });
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) removePushSub(sub.endpoint);
    else console.error("webpush:", code || err.message);
  }
}

async function pushToName(name, payload, { roomCode = "", isPublic = false } = {}) {
  const key = String(name || "").toLowerCase();
  if (!key) return;
  const targets = pushSubs.filter((s) => {
    if (String(s.name || "").toLowerCase() !== key) return false;
    if (isPublic) return s.channels?.public !== false;
    if (roomCode) return s.channels?.rooms !== false;
    return true;
  });
  await Promise.all(targets.map((s) => sendOne(s, payload)));
}

module.exports = {
  vapid,
  upsertPushSub,
  removePushSub,
  pushToName,
};
