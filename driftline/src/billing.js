import { createHmac, timingSafeEqual } from "node:crypto";

export function planFromMetadata(plan) {
  if (plan === "studio" || plan === "desk") return plan;
  return null;
}

export function verifyStripeSignature(payload, header, secret, toleranceSec = 300, nowMs = Date.now()) {
  if (!payload && payload !== "") return false;
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures = [];
  for (const piece of String(header).split(",")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (age > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "utf8");
    return given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
  });
}

export function billingConfigured(env = process.env) {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      env.STRIPE_PRICE_STUDIO &&
      env.STRIPE_PRICE_DESK &&
      env.PUBLIC_BASE_URL,
  );
}

export async function createCheckoutSession({
  secretKey,
  priceId,
  plan,
  userId,
  email,
  successUrl,
  cancelUrl,
}) {
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(userId),
    "metadata[plan]": plan,
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `Stripe responded ${response.status}`;
    throw new Error(message);
  }
  if (!json.url) throw new Error("Stripe did not return a checkout URL");
  return json;
}
