import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  webhook_url TEXT,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  focus TEXT,
  interval_minutes INTEGER NOT NULL,
  last_hash TEXT,
  last_excerpt TEXT,
  last_checked_at TEXT,
  last_changed_at TEXT,
  next_check_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  excerpt TEXT,
  previous_excerpt TEXT,
  created_at TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS watches_due ON watches(next_check_at);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id);
`;

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return new Store(db);
}

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

class Store {
  constructor(db) {
    this.db = db;
  }

  createUser(email, passwordHash) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
      .run(email, passwordHash, now);
    return this.getUserById(Number(result.lastInsertRowid));
  }

  getUserByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  }

  getUserById(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  setPlan(userId, plan, stripeCustomerId = undefined) {
    if (stripeCustomerId) {
      this.db
        .prepare("UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?")
        .run(plan, stripeCustomerId, userId);
    } else {
      this.db.prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, userId);
    }
  }

  setPlanByCustomer(customerId, plan) {
    if (!customerId) return 0;
    const result = this.db
      .prepare("UPDATE users SET plan = ? WHERE stripe_customer_id = ?")
      .run(plan, customerId);
    return Number(result.changes || 0);
  }

  setWebhook(userId, url) {
    this.db.prepare("UPDATE users SET webhook_url = ? WHERE id = ?").run(url, userId);
  }

  createSession(userId) {
    const token = randomToken();
    this.db
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, userId, isoIn(1000 * 60 * 60 * 24 * 30));
    return token;
  }

  userForSession(token) {
    if (!token) return undefined;
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, now);
    return row;
  }

  deleteSession(token) {
    if (!token) return;
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  countWatches(userId) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM watches WHERE user_id = ?").get(userId).n;
  }

  createWatch({ userId, label, url, focus, intervalMinutes }) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO watches
          (user_id, label, url, focus, interval_minutes, next_check_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
      )
      .run(userId, label, url, focus || null, intervalMinutes, now, now);
    return this.getWatch(Number(result.lastInsertRowid), userId);
  }

  listWatches(userId) {
    return this.db
      .prepare("SELECT * FROM watches WHERE user_id = ? ORDER BY id DESC")
      .all(userId);
  }

  getWatch(id, userId) {
    return this.db.prepare("SELECT * FROM watches WHERE id = ? AND user_id = ?").get(id, userId);
  }

  deleteWatch(id, userId) {
    const result = this.db.prepare("DELETE FROM watches WHERE id = ? AND user_id = ?").run(id, userId);
    return Number(result.changes || 0);
  }

  listDue(limit) {
    const now = new Date().toISOString();
    return this.db
      .prepare("SELECT * FROM watches WHERE next_check_at <= ? ORDER BY next_check_at LIMIT ?")
      .all(now, limit);
  }

  setNextCheck(id, iso) {
    this.db.prepare("UPDATE watches SET next_check_at = ? WHERE id = ?").run(iso, id);
  }

  finishCheck(watch, result) {
    const now = new Date().toISOString();
    const next = isoIn(watch.interval_minutes * 60 * 1000);
    if (result.error) {
      this.db
        .prepare(
          "UPDATE watches SET status = 'error', last_error = ?, last_checked_at = ?, next_check_at = ? WHERE id = ?",
        )
        .run(result.error, now, next, watch.id);
      if (watch.status !== "error" || watch.last_error !== result.error) {
        this.addEvent(watch, "error", result.error, null);
      }
      return;
    }
    const changed = result.status === "changed";
    this.db
      .prepare(
        `UPDATE watches
         SET status = ?, last_hash = ?, last_excerpt = ?, last_error = NULL,
             last_checked_at = ?, last_changed_at = COALESCE(?, last_changed_at), next_check_at = ?
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.hash,
        result.excerpt,
        now,
        changed ? now : null,
        next,
        watch.id,
      );
    if (changed) this.addEvent(watch, "change", result.excerpt, result.previous ?? null);
  }

  addEvent(watch, kind, excerpt, previous) {
    this.db
      .prepare(
        `INSERT INTO events (watch_id, user_id, kind, excerpt, previous_excerpt, created_at, seen)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(watch.id, watch.user_id, kind, excerpt, previous, new Date().toISOString());
  }

  listEvents(userId, limit = 20) {
    return this.db
      .prepare(
        `SELECT e.*, w.label, w.url FROM events e
         JOIN watches w ON w.id = e.watch_id
         WHERE e.user_id = ?
         ORDER BY e.id DESC LIMIT ?`,
      )
      .all(userId, limit);
  }

  listEventsForWatch(watchId, userId) {
    return this.db
      .prepare(
        "SELECT * FROM events WHERE watch_id = ? AND user_id = ? ORDER BY id DESC LIMIT 30",
      )
      .all(watchId, userId);
  }

  unseenByWatch(userId) {
    const rows = this.db
      .prepare(
        "SELECT watch_id, COUNT(*) AS n FROM events WHERE user_id = ? AND seen = 0 GROUP BY watch_id",
      )
      .all(userId);
    return new Map(rows.map((row) => [row.watch_id, row.n]));
  }

  markSeen(watchId, userId) {
    this.db.prepare("UPDATE events SET seen = 1 WHERE watch_id = ? AND user_id = ?").run(watchId, userId);
  }
}

function randomToken() {
  return randomBytes(32).toString("hex");
}
