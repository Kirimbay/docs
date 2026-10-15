import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyStripeSignature } from "../src/billing.js";
import { allowsInterval } from "../src/plans.js";
import { assertPublicHttpUrl, classifyIp } from "../src/ssrf.js";
import { digest, focusSlice, visibleText, wordDiff } from "../src/text.js";

test("visible text ignores script and style", () => {
  const html = "<style>Price $1</style><p>Price $5</p><script>Price $999</script>";
  const text = visibleText(html);
  assert.equal(text.includes("999"), false);
  assert.equal(text.includes("Price $1"), false);
  assert.equal(text.includes("Price $5"), true);
});

test("focus slice and digest stay stable for the same text", () => {
  const slice = focusSlice("Notebook Price $48 ships", "Price");
  assert.equal(slice.found, true);
  assert.equal(slice.text.startsWith("Price $48"), true);
  assert.equal(focusSlice("Notebook Price $48", "Missing").found, false);
  assert.equal(digest("same"), digest("same"));
  assert.notEqual(digest("Price $48"), digest("Price $49"));
});

test("word diff marks the price change", () => {
  const parts = wordDiff("Price $48 ships", "Price $49 ships");
  assert.deepEqual(parts.filter((part) => part.t === "del").map((part) => part.w), ["$48"]);
  assert.deepEqual(parts.filter((part) => part.t === "add").map((part) => part.w), ["$49"]);
});

test("private and link-local addresses stay blocked", async () => {
  assert.equal(classifyIp("169.254.169.254"), "blocked");
  assert.equal(classifyIp("10.1.2.3"), "blocked");
  assert.equal(classifyIp("192.168.0.4"), "blocked");
  assert.equal(classifyIp("127.0.0.1"), "loopback");
  assert.equal(classifyIp("8.8.8.8"), "public");
  await assert.rejects(
    () => assertPublicHttpUrl("http://169.254.169.254/latest", { allowLoopback: true }),
    /not allowed/,
  );
  await assert.rejects(
    () => assertPublicHttpUrl("http://127.0.0.1/", { allowLoopback: false }),
    /not allowed/,
  );
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"), /Only http/);
  await assert.rejects(
    () => assertPublicHttpUrl("http://user:pass@example.com/"),
    /username or password/,
  );
  const local = await assertPublicHttpUrl("http://127.0.0.1/sample", { allowLoopback: true });
  assert.equal(local.hostname, "127.0.0.1");
});

test("plan intervals match what the desk sells", () => {
  assert.equal(allowsInterval("free", 60), false);
  assert.equal(allowsInterval("free", 1440), true);
  assert.equal(allowsInterval("studio", 360), true);
  assert.equal(allowsInterval("studio", 60), false);
  assert.equal(allowsInterval("desk", 60), true);
});

test("stripe signatures reject tampering and stale timestamps", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const secret = "whsec_test";
  const timestamp = "1700000000";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  const now = 1700000000 * 1000;
  assert.equal(verifyStripeSignature(payload, header, secret, 300, now), true);
  assert.equal(verifyStripeSignature(`${payload}x`, header, secret, 300, now), false);
  assert.equal(verifyStripeSignature(payload, header, secret, 300, now + 3_600_000), false);
  assert.equal(verifyStripeSignature(payload, header, "other", 300, now), false);
});
