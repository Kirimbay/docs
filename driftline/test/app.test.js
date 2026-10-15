import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/server.js";

async function start() {
  return createApp({
    allowLoopback: true,
    schedule: false,
    env: {
      DRIFTLINE_CRON_SECRET: "cron-secret",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    },
  });
}

function cookieOf(response) {
  const list = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const line = list.find((item) => item.includes("dl_session="));
  return line ? line.split(";")[0] : "";
}

async function send(base, path, { method = "GET", cookie = "", form, json, headers = {} } = {}) {
  const body = json !== undefined ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined;
  return fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      origin: base,
      ...headers,
    },
    body,
  });
}

test("landing explains the price and the javascript limit", async () => {
  const app = await start();
  try {
    const response = await send(app.baseUrl, "/");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /\$15\/month/);
    assert.match(html, /\$39\/month/);
    assert.match(html, /does not run JavaScript/);
  } finally {
    await app.close();
  }
});

test("a desk watches the sample page and notices a price change", async () => {
  const app = await start();
  try {
    const health = await send(app.baseUrl, "/health");
    assert.deepEqual(await health.json(), { ok: true });

    const blocked = await send(app.baseUrl, "/app");
    assert.equal(blocked.status, 303);
    assert.equal(blocked.headers.get("location"), "/login");

    const weak = await send(app.baseUrl, "/signup", {
      method: "POST",
      form: { email: "ada@example.com", password: "short" },
    });
    assert.equal(weak.status, 400);

    const signup = await send(app.baseUrl, "/signup", {
      method: "POST",
      form: { email: "Ada@Example.com", password: "correct-horse" },
    });
    assert.equal(signup.status, 303);
    const cookie = cookieOf(signup);
    assert.match(cookie, /^dl_session=/);
    const emptyDesk = await (await send(app.baseUrl, "/app", { cookie })).text();
    assert.match(emptyDesk, /Watch the sample catalog/);

    const sample = `${app.baseUrl}/sample/catalog`;
    const created = await send(app.baseUrl, "/watches", {
      method: "POST",
      cookie,
      form: {
        label: "Notebook <script>alert(1)</script>",
        url: sample,
        focus: "Price",
        interval: "1440",
      },
    });
    assert.equal(created.status, 303);
    const watchPath = created.headers.get("location").split("?")[0];
    const page = await send(app.baseUrl, watchPath, { cookie });
    const baseline = await page.text();
    assert.match(baseline, /Steady/);
    assert.match(baseline, /\$48/);
    assert.equal(baseline.includes("<script>alert(1)</script>"), false);
    assert.match(baseline, /Notebook &lt;script&gt;/);

    const tooFast = await send(app.baseUrl, "/watches", {
      method: "POST",
      cookie,
      form: { label: "Hourly", url: sample, focus: "Price", interval: "60" },
    });
    assert.equal(tooFast.status, 400);
    assert.match(await tooFast.text(), /not included in your plan/);

    const metadata = await send(app.baseUrl, "/watches", {
      method: "POST",
      cookie,
      form: { label: "Metadata", url: "http://169.254.169.254/latest/meta-data/", interval: "1440" },
    });
    assert.equal(metadata.status, 400);
    assert.match(await metadata.text(), /not allowed/);

    for (let i = 0; i < 2; i += 1) {
      const extra = await send(app.baseUrl, "/watches", {
        method: "POST",
        cookie,
        form: { label: `Extra ${i}`, url: sample, focus: "Price", interval: "1440" },
      });
      assert.equal(extra.status, 303);
    }
    const limited = await send(app.baseUrl, "/watches", {
      method: "POST",
      cookie,
      form: { label: "Fourth", url: sample, focus: "Price", interval: "1440" },
    });
    assert.equal(limited.status, 400);
    assert.match(await limited.text(), /no room/);

    const bump = await send(app.baseUrl, "/sample/catalog", { method: "POST" });
    assert.equal(bump.status, 303);
    assert.equal(app.samplePrice, 49);

    const checked = await send(app.baseUrl, `${watchPath}/check`, { method: "POST", cookie });
    assert.equal(checked.status, 303);
    const changed = await (await send(app.baseUrl, watchPath, { cookie })).text();
    assert.match(changed, /Changed/);
    assert.match(changed, /\$49/);
    assert.match(changed, /<del>\$48<\/del>/);
    assert.match(changed, /<mark class="add">\$49<\/mark>/);

    const quiet = await send(app.baseUrl, `${watchPath}/check`, { method: "POST", cookie });
    assert.equal(quiet.status, 303);
    const steady = await (await send(app.baseUrl, watchPath, { cookie })).text();
    assert.match(steady, /Steady/);
  } finally {
    await app.close();
  }
});

test("the scheduler and a desk webhook fire without a person clicking", async () => {
  const app = await start();
  const hooks = [];
  const hookServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
  const hookPort = hookServer.address().port;
  try {
    const signup = await send(app.baseUrl, "/signup", {
      method: "POST",
      form: { email: "grace@example.com", password: "correct-horse" },
    });
    const cookie = cookieOf(signup);
    const created = await send(app.baseUrl, "/watches", {
      method: "POST",
      cookie,
      form: {
        label: "Notebook",
        url: `${app.baseUrl}/sample/catalog`,
        focus: "Price",
        interval: "1440",
      },
    });
    const watchPath = created.headers.get("location").split("?")[0];
    const watchId = Number(watchPath.split("/").pop());
    const user = app.db.getUserByEmail("grace@example.com");
    app.db.setPlan(user.id, "desk", "cus_test");
    app.db.setWebhook(user.id, `http://127.0.0.1:${hookPort}/hook`);
    app.db.setNextCheck(watchId, new Date(Date.now() - 1000).toISOString());

    const early = await send(app.baseUrl, "/ops/run", { method: "POST" });
    assert.equal(early.status, 401);
    const hidden = await send(app.baseUrl, "/ops/run", {
      method: "POST",
      headers: { "x-driftline-cron": "nope" },
    });
    assert.equal(hidden.status, 401);

    await send(app.baseUrl, "/sample/catalog", { method: "POST" });
    const ran = await send(app.baseUrl, "/ops/run", {
      method: "POST",
      headers: { "x-driftline-cron": "cron-secret" },
    });
    const report = await ran.json();
    assert.equal(ran.status, 200);
    assert.equal(report.results[0].status, "changed");
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].label, "Notebook");
    assert.match(hooks[0].excerpt, /\$49/);

    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_test" } },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${payload}`).digest("hex");
    const webhook = await send(app.baseUrl, "/billing/webhook", {
      method: "POST",
      json: JSON.parse(payload),
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    });
    assert.equal(webhook.status, 200);
    assert.equal(app.db.getUserByEmail("grace@example.com").plan, "free");

    const upgradePayload = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: String(user.id),
          customer: "cus_live",
          metadata: { plan: "studio" },
        },
      },
    });
    const upgradeStamp = String(Math.floor(Date.now() / 1000));
    const upgradeSig = createHmac("sha256", "whsec_test")
      .update(`${upgradeStamp}.${upgradePayload}`)
      .digest("hex");
    const upgraded = await send(app.baseUrl, "/billing/webhook", {
      method: "POST",
      json: JSON.parse(upgradePayload),
      headers: { "stripe-signature": `t=${upgradeStamp},v1=${upgradeSig}` },
    });
    assert.equal(upgraded.status, 200);
    const after = app.db.getUserByEmail("grace@example.com");
    assert.equal(after.plan, "studio");
    assert.equal(after.stripe_customer_id, "cus_live");

    const checkout = await send(app.baseUrl, "/billing/checkout", {
      method: "POST",
      cookie,
      form: { plan: "desk" },
    });
    assert.equal(checkout.status, 501);
    assert.match(await checkout.text(), /not connected|PUBLIC_BASE_URL/);
  } finally {
    hookServer.close();
    await app.close();
  }
});
