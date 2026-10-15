import { digest, focusSlice, visibleText } from "./text.js";
import { fetchPublic, postJsonPublic, publicError } from "./ssrf.js";

export async function checkWatch(db, watch, options = {}) {
  const user = db.getUserById(watch.user_id);
  try {
    const html = await fetchPublic(watch.url, options);
    const text = visibleText(html);
    const slice = focusSlice(text, watch.focus);
    if (watch.focus && !slice.found) {
      const message = `Focus text was not on the page`;
      db.finishCheck(watch, { error: message });
      return { status: "error", message };
    }
    const body = (slice.text || "").slice(0, 20000);
    if (!body) {
      db.finishCheck(watch, { error: "Page had no readable text" });
      return { status: "error", message: "Page had no readable text" };
    }
    const hash = digest(body);
    const excerpt = body.slice(0, 800);
    if (!watch.last_hash) {
      db.finishCheck(watch, { status: "ok", hash, excerpt });
      return { status: "ok", baseline: true };
    }
    if (hash === watch.last_hash) {
      db.finishCheck(watch, { status: "ok", hash, excerpt });
      return { status: "ok" };
    }
    db.finishCheck(watch, {
      status: "changed",
      hash,
      excerpt,
      previous: watch.last_excerpt,
    });
    await notifyChange({ db, watch, user, excerpt, previous: watch.last_excerpt, options });
    return { status: "changed" };
  } catch (err) {
    const message = publicError(err);
    db.finishCheck(watch, { error: message });
    return { status: "error", message };
  }
}

export async function runDueChecks(db, options = {}) {
  const due = db.listDue(options.limit ?? 20);
  const results = [];
  for (const watch of due) {
    results.push({ id: watch.id, ...(await checkWatch(db, watch, options)) });
  }
  return results;
}

async function notifyChange({ db, watch, user, excerpt, previous, options }) {
  const env = options.env || process.env;
  if (env.RESEND_API_KEY && env.RESEND_FROM && user?.email) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [user.email],
          subject: `Driftline: ${watch.label} changed`,
          text: [
            `${watch.label} changed.`,
            watch.url,
            "",
            "Before:",
            previous || "(no earlier excerpt)",
            "",
            "After:",
            excerpt,
          ].join("\n"),
        }),
      });
      if (!response.ok) {
        console.error(`Resend responded ${response.status} for watch ${watch.id}`);
      }
    } catch (err) {
      console.error(`Mail failed for watch ${watch.id}: ${err.message}`);
    }
  }
  if (user?.plan === "desk" && user.webhook_url) {
    try {
      await postJsonPublic(
        user.webhook_url,
        {
          watchId: watch.id,
          label: watch.label,
          url: watch.url,
          excerpt,
          previous: previous || "",
          at: new Date().toISOString(),
        },
        options,
      );
    } catch (err) {
      db.addEvent(watch, "error", `Webhook failed: ${publicError(err)}`, null);
    }
  }
}
