import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashPassword, readCookie, safeEqualString, sessionCookie, validEmail, verifyPassword } from "./auth.js";
import { billingConfigured, createCheckoutSession, planFromMetadata, verifyStripeSignature } from "./billing.js";
import { checkWatch, runDueChecks } from "./checker.js";
import { openDb } from "./db.js";
import { allowsInterval, planById } from "./plans.js";
import { assertPublicHttpUrl, SsrfError } from "./ssrf.js";
import {
  MESSAGES,
  renderApp,
  renderAuth,
  renderLanding,
  renderMessage,
  renderPricing,
  renderSample,
  renderSettings,
  renderWatch,
} from "./views.js";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function createLimiter() {
  const hits = new Map();
  return (key, max, windowMs) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    return false;
  };
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, status, body, extra = {}) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    ...SECURITY,
    "content-type": "text/html; charset=utf-8",
    "content-length": payload.length,
    ...extra,
  });
  res.end(payload);
}

function sendJson(res, status, value) {
  const payload = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    ...SECURITY,
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
  });
  res.end(payload);
}

function redirect(res, location, cookie) {
  const headers = { ...SECURITY, location };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientIp(req) {
  return req.socket?.remoteAddress || "unknown";
}

export async function createApp(options = {}) {
  const db = options.db || openDb(options.dbPath || ":memory:");
  const allowLoopback = options.allowLoopback ?? false;
  const env = options.env || process.env;
  const secureCookie = String(env.PUBLIC_BASE_URL || "").startsWith("https://");
  const limited = createLimiter();
  let samplePrice = 48;
  let ticking = false;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await runDueChecks(db, { allowLoopback, env });
    } catch (err) {
      console.error(err);
    } finally {
      ticking = false;
    }
  }

  async function route(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    const method = req.method || "GET";
    const notice = MESSAGES[url.searchParams.get("m")] || "";
    const token = readCookie(req, "dl_session");
    const user = db.userForSession(token);

    if (method === "POST" && path !== "/billing/webhook" && !sameOrigin(req)) {
      send(res, 403, renderMessage("Blocked", "That request did not come from this desk.", user));
      return;
    }

    if (method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/") {
      send(res, 200, renderLanding({ user, notice }));
      return;
    }

    if (method === "GET" && path === "/pricing") {
      send(res, 200, renderPricing({ user, notice }));
      return;
    }

    if (method === "GET" && path === "/signup") {
      send(res, 200, renderAuth({ mode: "signup", user, notice }));
      return;
    }

    if (method === "GET" && path === "/login") {
      send(res, 200, renderAuth({ mode: "login", user, notice }));
      return;
    }

    if (method === "GET" && path === "/sample/catalog") {
      send(res, 200, renderSample({ price: samplePrice }));
      return;
    }

    if (method === "POST" && path === "/sample/catalog") {
      samplePrice += 1;
      redirect(res, "/sample/catalog");
      return;
    }

    if (method === "POST" && path === "/ops/run") {
      const secret = env.DRIFTLINE_CRON_SECRET || "";
      const given = req.headers["x-driftline-cron"] || "";
      if (!secret) {
        send(res, 404, renderMessage("Not found", "No such page.", user));
        return;
      }
      if (!safeEqualString(given, secret)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const results = await tickAndReport();
      sendJson(res, 200, { checked: results.length, results });
      return;
    }

    if (method === "POST" && path === "/billing/webhook") {
      const raw = await readRaw(req, 200_000);
      const header = req.headers["stripe-signature"] || "";
      if (!verifyStripeSignature(raw, header, env.STRIPE_WEBHOOK_SECRET || "")) {
        sendJson(res, 400, { error: "bad signature" });
        return;
      }
      const event = JSON.parse(raw);
      applyStripeEvent(db, event);
      sendJson(res, 200, { received: true });
      return;
    }

    if (method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await readRaw(req, 100_000)));
      const outcome = await postForm({
        path, form, user, token, req, db, allowLoopback, env, secureCookie, limited, notice,
      });
      if (outcome.cookie) {
        if (outcome.redirect) redirect(res, outcome.redirect, outcome.cookie);
        else send(res, outcome.status || 200, outcome.html, { "set-cookie": outcome.cookie });
        return;
      }
      if (outcome.redirect) {
        redirect(res, outcome.redirect);
        return;
      }
      send(res, outcome.status || 200, outcome.html);
      return;
    }

    if (method === "GET" && path === "/app") {
      if (!user) {
        redirect(res, "/login");
        return;
      }
      send(res, 200, renderApp(deskProps(req, user, notice)));
      return;
    }

    if (method === "GET" && path === "/settings") {
      if (!user) {
        redirect(res, "/login");
        return;
      }
      send(res, 200, renderSettings({ user, notice }));
      return;
    }

    const watchMatch = path.match(/^\/watches\/(\d+)$/);
    if (method === "GET" && watchMatch) {
      if (!user) {
        redirect(res, "/login");
        return;
      }
      const watch = db.getWatch(Number(watchMatch[1]), user.id);
      if (!watch) {
        send(res, 404, renderMessage("Not found", "That watch is not on this desk.", user));
        return;
      }
      db.markSeen(watch.id, user.id);
      const events = db.listEventsForWatch(watch.id, user.id);
      send(res, 200, renderWatch({ user, notice, watch, events }));
      return;
    }

    send(res, 404, renderMessage("Not found", "No such page.", user));
  }

  async function tickAndReport() {
    if (ticking) return [];
    ticking = true;
    try {
      return await runDueChecks(db, { allowLoopback, env });
    } finally {
      ticking = false;
    }
  }

  function deskProps(req, user, pageNotice, error = "") {
    return {
      user,
      notice: pageNotice,
      error,
      watches: db.listWatches(user.id),
      events: db.listEvents(user.id),
      unseen: db.unseenByWatch(user.id),
      sampleUrl: `${forwardedProto(req)}://${req.headers.host}/sample/catalog`,
    };
  }

  async function postForm(ctx) {
    const { path, form, req } = ctx;
    if (path === "/signup") return signup(ctx);
    if (path === "/login") return login(ctx);
    if (path === "/logout") return logout(ctx);
    if (!ctx.user) return { redirect: "/login" };
    if (path === "/watches") return addWatch(ctx);
    if (path === "/settings") return saveSettings(ctx);
    if (path === "/billing/checkout") return startCheckout(ctx);
    const check = path.match(/^\/watches\/(\d+)\/check$/);
    if (check) return checkNow(ctx, Number(check[1]));
    const remove = path.match(/^\/watches\/(\d+)\/delete$/);
    if (remove) return removeWatch(ctx, Number(remove[1]));
    return { status: 404, html: renderMessage("Not found", "No such page.", ctx.user) };
  }

  function signup(ctx) {
    const ip = clientIp(ctx.req);
    if (limited(`signup:${ip}`, 8, 60 * 60 * 1000)) {
      return { status: 429, html: renderAuth({ mode: "signup", error: MESSAGES.rate }) };
    }
    const email = String(ctx.form.email || "").trim().toLowerCase();
    const password = String(ctx.form.password || "");
    if (!validEmail(email)) return { status: 400, html: renderAuth({ mode: "signup", error: MESSAGES.bademail }) };
    if (password.length < 10 || password.length > 200) {
      return { status: 400, html: renderAuth({ mode: "signup", error: MESSAGES.weak }) };
    }
    if (db.getUserByEmail(email)) {
      return { status: 409, html: renderAuth({ mode: "signup", error: MESSAGES.exists }) };
    }
    const created = db.createUser(email, hashPassword(password));
    const session = db.createSession(created.id);
    return { redirect: "/app?m=welcome", cookie: sessionCookie(session, { secure: secureCookie }) };
  }

  function login(ctx) {
    const ip = clientIp(ctx.req);
    if (limited(`login:${ip}`, 30, 60 * 60 * 1000)) {
      return { status: 429, html: renderAuth({ mode: "login", error: MESSAGES.rate }) };
    }
    const email = String(ctx.form.email || "").trim().toLowerCase();
    const password = String(ctx.form.password || "");
    const existing = db.getUserByEmail(email);
    if (!existing || !verifyPassword(password, existing.password_hash)) {
      return { status: 401, html: renderAuth({ mode: "login", error: MESSAGES.badlogin }) };
    }
    const session = db.createSession(existing.id);
    return { redirect: "/app", cookie: sessionCookie(session, { secure: secureCookie }) };
  }

  function logout(ctx) {
    db.deleteSession(ctx.token);
    return { redirect: "/", cookie: sessionCookie("", { secure: secureCookie, maxAge: 0 }) };
  }

  async function addWatch(ctx) {
    const { user, form } = ctx;
    const label = String(form.label || "").trim();
    const target = String(form.url || "").trim();
    const focus = String(form.focus || "").trim();
    const interval = Number(form.interval);
    if (!label || !target) return deskError(ctx, MESSAGES.missing);
    if (label.length > 120) return deskError(ctx, MESSAGES.labellen);
    if (focus.length > 200) return deskError(ctx, MESSAGES.focuslen);
    if (!allowsInterval(user.plan, interval)) return deskError(ctx, MESSAGES.interval);
    if (db.countWatches(user.id) >= planById(user.plan).watches) return deskError(ctx, MESSAGES.limit);
    try {
      await assertPublicHttpUrl(target, { allowLoopback });
    } catch (err) {
      const detail = err instanceof SsrfError ? err.message : MESSAGES.badurl;
      return deskError(ctx, detail);
    }
    const watch = db.createWatch({
      userId: user.id,
      label,
      url: target,
      focus,
      intervalMinutes: interval,
    });
    await checkWatch(db, watch, { allowLoopback, env });
    return { redirect: `/watches/${watch.id}?m=created` };
  }

  function deskError(ctx, error) {
    return { status: 400, html: renderApp({ ...deskProps(ctx.req, ctx.user, ""), error }) };
  }

  async function checkNow(ctx, id) {
    const watch = db.getWatch(id, ctx.user.id);
    if (!watch) return { status: 404, html: renderMessage("Not found", "That watch is not on this desk.", ctx.user) };
    if (limited(`check:${ctx.user.id}:${id}`, 30, 60 * 60 * 1000)) {
      return { redirect: `/watches/${id}?m=rate` };
    }
    await checkWatch(db, watch, { allowLoopback, env });
    return { redirect: `/watches/${id}?m=checked` };
  }

  function removeWatch(ctx, id) {
    db.deleteWatch(id, ctx.user.id);
    return { redirect: "/app?m=deleted" };
  }

  async function saveSettings(ctx) {
    const plan = planById(ctx.user.plan);
    if (!plan.webhook) {
      return { status: 403, html: renderSettings({ user: ctx.user, error: MESSAGES.webhookplan }) };
    }
    const webhook = String(ctx.form.webhook || "").trim();
    if (!webhook) {
      db.setWebhook(ctx.user.id, null);
      return { redirect: "/settings?m=webhook" };
    }
    try {
      await assertPublicHttpUrl(webhook, { allowLoopback });
    } catch (err) {
      const detail = err instanceof SsrfError ? err.message : MESSAGES.webhookbad;
      return { status: 400, html: renderSettings({ user: ctx.user, error: detail }) };
    }
    db.setWebhook(ctx.user.id, webhook);
    return { redirect: "/settings?m=webhook" };
  }

  async function startCheckout(ctx) {
    const plan = String(ctx.form.plan || "");
    if (plan !== "studio" && plan !== "desk") {
      return { status: 400, html: renderPricing({ user: ctx.user, notice: MESSAGES.billingoff }) };
    }
    if (!billingConfigured(env)) {
      const notice = env.STRIPE_SECRET_KEY ? MESSAGES.billingsetup : MESSAGES.billingoff;
      return { status: 501, html: renderPricing({ user: ctx.user, notice }) };
    }
    const priceId = plan === "studio" ? env.STRIPE_PRICE_STUDIO : env.STRIPE_PRICE_DESK;
    const base = String(env.PUBLIC_BASE_URL).replace(/\/$/, "");
    try {
      const session = await createCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        priceId,
        plan,
        userId: ctx.user.id,
        email: ctx.user.email,
        successUrl: `${base}/pricing?m=returned`,
        cancelUrl: `${base}/pricing?m=cancelled`,
      });
      return { redirect: session.url };
    } catch (err) {
      console.error(`Stripe checkout failed: ${err.message}`);
      return { status: 502, html: renderPricing({ user: ctx.user, notice: MESSAGES.billingoff }) };
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      console.error(err);
      const status = err.statusCode || 500;
      if (!res.headersSent) {
        send(res, status, renderMessage("Something went wrong", "The desk hit an unexpected error."));
      }
    }
  });

  const host = options.host || "127.0.0.1";
  await new Promise((resolve) => server.listen(options.port ?? 0, host, resolve));
  const { port } = server.address();
  let timer;
  if (options.schedule) {
    timer = setInterval(() => {
      tick().catch((err) => console.error(err));
    }, options.intervalMs ?? 20_000);
    timer.unref?.();
  }

  return {
    server,
    db,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    get samplePrice() {
      return samplePrice;
    },
    async close() {
      clearInterval(timer);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function forwardedProto(req) {
  const header = req.headers["x-forwarded-proto"];
  if (typeof header === "string" && header) return header.split(",")[0].trim();
  return "http";
}

function applyStripeEvent(db, event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const plan = planFromMetadata(session.metadata?.plan);
    const userId = Number(session.client_reference_id);
    if (!plan || !Number.isInteger(userId)) return;
    const user = db.getUserById(userId);
    if (!user) return;
    db.setPlan(userId, plan, session.customer || null);
    return;
  }
  if (event.type === "customer.subscription.deleted") {
    const customer = event.data?.object?.customer;
    db.setPlanByCustomer(customer, "free");
  }
}

function envFlag(name, fallback) {
  if (process.env[name] === "1") return true;
  if (process.env[name] === "0") return false;
  return fallback;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = dirname(fileURLToPath(import.meta.url));
  const app = await createApp({
    dbPath: process.env.DRIFTLINE_DB || join(root, "..", "data", "driftline.sqlite"),
    allowLoopback: envFlag("DRIFTLINE_ALLOW_LOOPBACK", process.env.NODE_ENV !== "production"),
    schedule: true,
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || "127.0.0.1",
  });
  console.log(`Driftline desk ${app.baseUrl}`);
}
