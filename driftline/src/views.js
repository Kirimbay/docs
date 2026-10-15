import { intervalLabel, intervalsFor, PLANS } from "./plans.js";
import { wordDiff } from "./text.js";

export const MESSAGES = {
  welcome: "Desk is ready. Add a public page.",
  created: "Watch added and checked.",
  deleted: "Watch removed.",
  checked: "Check finished.",
  badlogin: "That email and password do not match.",
  exists: "An account with that email already exists.",
  weak: "Use at least 10 characters.",
  bademail: "Enter a real email address.",
  limit: "This plan has no room for another page.",
  interval: "That schedule is not included in your plan.",
  badurl: "That address cannot be watched.",
  focuslen: "Keep the focus text under 200 characters.",
  labellen: "Keep the label under 120 characters.",
  webhook: "Webhook saved.",
  webhookbad: "That webhook address is not allowed.",
  webhookplan: "Webhooks are part of the Desk plan.",
  billingoff: "Paid checkout is not connected on this server yet. The free desk still works.",
  billingsetup: "Checkout needs Stripe price ids, a webhook secret, and PUBLIC_BASE_URL.",
  returned: "Back from checkout. The plan updates when Stripe calls the webhook.",
  cancelled: "Checkout closed. No charge was made.",
  rate: "Too many attempts. Wait a little and try again.",
  missing: "Label and URL are both required.",
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function formatTime(iso) {
  if (!iso) return "not yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "not yet";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function statusWord(status) {
  if (status === "changed") return "Changed";
  if (status === "error") return "Problem";
  if (status === "ok") return "Steady";
  return "New";
}

const CSS = `
:root {
  --bg: #f3efe6;
  --paper: #fffdf8;
  --ink: #1a1714;
  --muted: #5e574e;
  --line: #ddd4c6;
  --rust: #b8421a;
  --ok: #215c32;
  --bad: #8d2433;
  --warn: #8a5a12;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --serif: Georgia, "Iowan Old Style", Palatino, "Palatino Linotype", serif;
  --sans: "Avenir Next", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--ink); }
body {
  margin: 0;
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.5;
}
a { color: inherit; }
.top {
  background: var(--ink);
  color: var(--bg);
}
.top-inner, .wrap { width: min(1040px, calc(100% - 32px)); margin: 0 auto; }
.top-inner { display: flex; align-items: center; gap: 22px; min-height: 64px; }
.brand { font-family: var(--serif); font-size: 22px; letter-spacing: -0.03em; text-decoration: none; }
.nav { display: flex; gap: 16px; margin-left: auto; align-items: center; flex-wrap: wrap; }
.nav a, .nav button.linkish { color: var(--bg); text-decoration: none; font-size: 14px; }
.nav button.linkish { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
.who { color: #cfc6b8; font-size: 13px; }
.wrap { padding: 36px 0 72px; }
.kicker {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 12px;
}
h1 {
  font-family: var(--serif);
  font-weight: 500;
  font-size: clamp(36px, 6vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.03em;
  margin: 0 0 16px;
}
h2 { font-family: var(--serif); font-weight: 500; font-size: 32px; letter-spacing: -0.03em; margin: 0 0 8px; }
.lede { font-size: 18px; max-width: 62ch; margin: 0 0 22px; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.button, button.primary, button.quiet {
  display: inline-block;
  border: 0;
  cursor: pointer;
  text-decoration: none;
  font: inherit;
  padding: 10px 14px;
}
.button.primary, button.primary { background: var(--rust); color: #fffdf8; }
.button.quiet, button.quiet { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.steps, .desk, .two { display: grid; gap: 18px; }
.steps { grid-template-columns: repeat(3, 1fr); margin: 42px 0; }
.step { border-top: 1px solid var(--ink); padding-top: 12px; }
.step b { display: block; font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em; margin-bottom: 8px; }
.note, .banner, .panel {
  background: var(--paper);
  border: 1px solid var(--line);
  padding: 14px 16px;
}
.banner { margin-bottom: 18px; }
.panel h2 { font-size: 22px; }
label { display: block; font-size: 13px; margin: 12px 0 4px; }
input, select {
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  padding: 8px 10px;
}
.help { color: var(--muted); font-size: 13px; }
table { width: 100%; border-collapse: collapse; background: var(--paper); }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 13px; font-weight: 600; }
.url { font-family: var(--mono); font-size: 12px; word-break: break-all; }
.tag {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tag.ok { color: var(--ok); }
.tag.changed { color: var(--rust); }
.tag.error { color: var(--bad); }
.tag.new { color: var(--warn); }
.desk { grid-template-columns: 300px 1fr; align-items: start; }
.two { grid-template-columns: 1fr 1fr; }
.diff { line-height: 1.6; }
mark.add { background: #f3d2c6; color: inherit; }
del { color: var(--bad); }
.excerpt { white-space: pre-wrap; font-family: var(--sans); }
.row-actions { display: flex; gap: 8px; }
.row-actions form { margin: 0; }
footer.colophon { color: var(--muted); font-size: 13px; margin-top: 36px; max-width: 70ch; }
:focus-visible { outline: 2px solid var(--rust); outline-offset: 2px; }
@media (max-width: 800px) {
  .steps, .desk, .two { grid-template-columns: 1fr; }
  .top-inner { align-items: flex-start; padding: 12px 0; flex-direction: column; gap: 8px; }
  .nav { margin-left: 0; }
}
`;

function layout({ title, user, body }) {
  const nav = user
    ? `<a href="/app">Desk</a>
       <a href="/pricing">Pricing</a>
       <a href="/settings">Settings</a>
       <span class="who">${esc(user.email)}</span>
       <form method="post" action="/logout"><button class="linkish" type="submit">Log out</button></form>`
    : `<a href="/pricing">Pricing</a>
       <a href="/login">Log in</a>
       <a href="/signup">Open a desk</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="Driftline checks public pages on a schedule and notes you when the text changes.">
  <style>${CSS}</style>
</head>
<body>
  <header class="top"><div class="top-inner">
    <a class="brand" href="/">Driftline</a>
    <nav class="nav">${nav}</nav>
  </div></header>
  <main class="wrap">${body}</main>
</body>
</html>`;
}

function banner(notice) {
  if (!notice) return "";
  return `<p class="banner" role="status">${esc(notice)}</p>`;
}

export function renderLanding({ user, notice }) {
  return layout({
    title: "Driftline — the page moved",
    user,
    body: `
      ${banner(notice)}
      <p class="kicker">Public page watch</p>
      <h1>The page moved. You didn’t have to keep looking.</h1>
      <p class="lede">Driftline rereads public pages on a schedule and leaves a note when the text changes. Competitor prices, docs, supplier stock, a deadline that keeps slipping.</p>
      <div class="actions">
        <a class="button primary" href="${user ? "/app" : "/signup"}">${user ? "Open the desk" : "Open a free desk"}</a>
        <a class="button quiet" href="/sample/catalog">Look at the sample page</a>
      </div>
      <section class="steps">
        <article class="step"><b>01</b> You name a public URL, and optionally a phrase to keep in frame, such as Price.</article>
        <article class="step"><b>02</b> The desk fetches the HTML the server actually sends and remembers the text.</article>
        <article class="step"><b>03</b> When that text changes, the note shows up here. Mail and a webhook are optional.</article>
      </section>
      <section class="two">
        <div>
          <h2>Who pays for this</h2>
          <p>A shop that wants a quiet alert when a rival’s server-rendered price moves. A freelancer watching a public changelog. Anyone refreshing a deadline page they do not control.</p>
        </div>
        <div class="note">
          <p class="kicker">Limit, stated once</p>
          <p>Driftline does not run JavaScript and does not log into sites. If a price appears only after a script runs, this desk will not see it. It also refuses private networks, so it cannot be aimed at cloud metadata or your own machines.</p>
        </div>
      </section>
      <footer class="colophon">Free is 3 pages, once a day. Studio is $${PLANS.studio.price}/month for 30 pages, four times a day. Desk is $${PLANS.desk.price}/month for 150 pages, hourly, with a webhook. Visualping and Distill are the incumbents; Driftline is the small text-only version.</footer>
    `,
  });
}

export function renderPricing({ user, notice }) {
  const rows = ["free", "studio", "desk"].map((id) => {
    const plan = PLANS[id];
    const action = plan.price === 0
      ? `<a href="${user ? "/app" : "/signup"}">Use free</a>`
      : (user
        ? `<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${plan.id}"><button class="primary" type="submit">Choose ${esc(plan.label)}</button></form>`
        : `<a href="/signup">Open a desk first</a>`);
    return `<tr>
      <td><strong>${esc(plan.label)}</strong><div class="help">${esc(plan.summary)}</div></td>
      <td>${plan.price === 0 ? "$0" : `$${plan.price}/mo`}</td>
      <td>${plan.watches}</td>
      <td>${esc(intervalLabel(plan.minInterval))}</td>
      <td>${plan.webhook ? "Yes" : "No"}</td>
      <td>${action}</td>
    </tr>`;
  }).join("");
  return layout({
    title: "Driftline pricing",
    user,
    body: `
      ${banner(notice)}
      <p class="kicker">Pricing</p>
      <h1>Pay for room and for how often the desk looks.</h1>
      <p class="lede">Checks are of the raw HTML. Faster than hourly, screenshots, and JavaScript rendering are not in these plans.</p>
      <table>
        <thead><tr><th>Plan</th><th>Price</th><th>Pages</th><th>Fastest check</th><th>Webhook</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="help">Checkout uses Stripe. Until the operator connects keys, the buttons explain that paid plans are not open yet. The free desk does not wait on that.</p>
    `,
  });
}

export function renderAuth({ mode, user, notice, error }) {
  const signup = mode === "signup";
  return layout({
    title: signup ? "Open a Driftline desk" : "Log in to Driftline",
    user,
    body: `
      ${banner(notice || error)}
      <p class="kicker">${signup ? "New desk" : "Return"}</p>
      <h1>${signup ? "Open a desk" : "Log in"}</h1>
      <form class="panel" method="post" action="${signup ? "/signup" : "/login"}" style="max-width: 420px">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="10" required>
        <p class="help">${signup ? "At least 10 characters. This password stays on your server as a scrypt hash." : "Use the password from signup."}</p>
        <p><button class="primary" type="submit">${signup ? "Create the desk" : "Log in"}</button></p>
      </form>
      <p class="help"><a href="${signup ? "/login" : "/signup"}">${signup ? "I already have a desk" : "I need a desk"}</a></p>
    `,
  });
}

export function renderApp({ user, notice, error, watches, events, unseen, sampleUrl }) {
  const options = intervalsFor(user.plan).map((item) =>
    `<option value="${item.minutes}">${esc(item.label)}</option>`).join("");
  const plan = PLANS[user.plan] || PLANS.free;
  const rows = watches.length
    ? watches.map((watch) => {
      const fresh = unseen.get(watch.id) ? " · unread" : "";
      return `<tr>
        <td><a href="/watches/${watch.id}">${esc(watch.label)}</a><div class="url">${esc(watch.url)}</div></td>
        <td><span class="tag ${esc(watch.status)}">${esc(statusWord(watch.status))}${esc(fresh)}</span></td>
        <td>${esc(formatTime(watch.last_checked_at))}</td>
        <td class="row-actions">
          <form method="post" action="/watches/${watch.id}/check"><button class="quiet" type="submit">Check now</button></form>
          <form method="post" action="/watches/${watch.id}/delete"><button class="quiet" type="submit">Remove</button></form>
        </td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="4">No pages yet. The sample catalog is a safe first watch: <span class="url">${esc(sampleUrl)}</span> with focus text <strong>Price</strong>. Then change the sample price and check again.</td></tr>`;
  const feed = events.length
    ? `<ul>${events.slice(0, 8).map((event) =>
      `<li><a href="/watches/${event.watch_id}">${esc(event.label)}</a> · ${esc(event.kind)} · ${esc(formatTime(event.created_at))}</li>`).join("")}</ul>`
    : `<p class="help">Notes land here after a page actually changes.</p>`;
  return layout({
    title: "Driftline desk",
    user,
    body: `
      ${banner(notice || error)}
      <p class="kicker">${esc(plan.label)} · ${plan.watches} pages max</p>
      <h1>Desk</h1>
      <div class="desk">
        <form class="panel" method="post" action="/watches">
          <h2>Add a page</h2>
          <label for="label">Label</label>
          <input id="label" name="label" maxlength="120" required placeholder="Rival notebook">
          <label for="url">Public URL</label>
          <input id="url" name="url" type="url" required placeholder="https://example.com/notebook">
          <label for="focus">Focus text, optional</label>
          <input id="focus" name="focus" maxlength="200" placeholder="Price">
          <p class="help">If set, only the text starting at that phrase is compared.</p>
          <label for="interval">Schedule</label>
          <select id="interval" name="interval">${options}</select>
          <p><button class="primary" type="submit">Watch it</button></p>
        </form>
        <div>
          <table>
            <thead><tr><th>Page</th><th>State</th><th>Last check</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <h2 style="margin-top:28px">Recent notes</h2>
          ${feed}
        </div>
      </div>
    `,
  });
}

function diffBlock(previous, next) {
  if (!previous) return `<p class="excerpt">${esc(next || "")}</p>`;
  const parts = wordDiff(previous, next || "");
  const html = parts.map((part) => {
    const word = esc(part.w);
    if (part.t === "add") return `<mark class="add">${word}</mark>`;
    if (part.t === "del") return `<del>${word}</del>`;
    return word;
  }).join(" ");
  return `<p class="diff">${html}</p>`;
}

export function renderWatch({ user, notice, watch, events }) {
  const history = events.length
    ? events.map((event) => `
      <article class="note" style="margin-bottom:12px">
        <p class="kicker">${esc(event.kind)} · ${esc(formatTime(event.created_at))}</p>
        ${event.kind === "change" ? diffBlock(event.previous_excerpt, event.excerpt) : `<p>${esc(event.excerpt || "")}</p>`}
      </article>`).join("")
    : `<p class="help">No notes yet. The first check only stores a baseline.</p>`;
  return layout({
    title: `${watch.label} · Driftline`,
    user,
    body: `
      ${banner(notice)}
      <p class="kicker"><a href="/app">Desk</a> / ${esc(statusWord(watch.status))}</p>
      <h1>${esc(watch.label)}</h1>
      <p class="url">${esc(watch.url)}</p>
      <p class="help">Focus: ${watch.focus ? esc(watch.focus) : "whole page"} · ${esc(intervalLabel(watch.interval_minutes))} · next look ${esc(formatTime(watch.next_check_at))}</p>
      ${watch.last_error ? `<p class="banner">${esc(watch.last_error)}</p>` : ""}
      <div class="actions" style="margin: 16px 0">
        <form method="post" action="/watches/${watch.id}/check"><button class="primary" type="submit">Check now</button></form>
        <form method="post" action="/watches/${watch.id}/delete"><button class="quiet" type="submit">Remove</button></form>
      </div>
      <h2>Latest text</h2>
      <div class="note excerpt">${esc(watch.last_excerpt || "Nothing stored yet.")}</div>
      <h2 style="margin-top:28px">Notes</h2>
      ${history}
    `,
  });
}

export function renderSettings({ user, notice, error }) {
  const plan = PLANS[user.plan] || PLANS.free;
  return layout({
    title: "Driftline settings",
    user,
    body: `
      ${banner(notice || error)}
      <p class="kicker">Settings</p>
      <h1>How notes leave the desk</h1>
      <p class="lede">You are on <strong>${esc(plan.label)}</strong>. Mail goes out only if the operator has set Resend. The in-app notes do not need that.</p>
      <form class="panel" method="post" action="/settings" style="max-width: 560px">
        <label for="webhook">Webhook URL</label>
        <input id="webhook" name="webhook" type="url" value="${esc(user.webhook_url || "")}" placeholder="https://example.com/hooks/driftline" ${plan.webhook ? "" : "disabled"}>
        <p class="help">${plan.webhook
          ? "Desk plan posts JSON here when a page changes. Redirects are not followed."
          : "Webhooks turn on with the Desk plan. Leave this until then."}</p>
        ${plan.webhook ? `<p><button class="primary" type="submit">Save webhook</button></p>` : ""}
      </form>
    `,
  });
}

export function renderSample({ price }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sample catalog</title>
  <style>${CSS}</style>
</head>
<body>
  <main class="wrap">
    <p class="kicker">Fixture, not a product</p>
    <h1>Northwind notebook</h1>
    <p>This page exists so you can watch a change without leaving the machine.</p>
    <p>Price <strong>$${Number(price)}</strong></p>
    <p>Ships in 3 days. Stock is open.</p>
    <form method="post" action="/sample/catalog">
      <button class="primary" type="submit">Raise the sample price by $1</button>
    </form>
    <p class="help">Watch this URL with focus text Price. Raise the price, then run Check now.</p>
  </main>
</body>
</html>`;
}

export function renderMessage(title, text, user) {
  return layout({
    title,
    user,
    body: `<h1>${esc(title)}</h1><p class="lede">${esc(text)}</p><p><a href="/">Back to the front</a></p>`,
  });
}
