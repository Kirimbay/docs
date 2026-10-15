import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfError";
  }
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);

function ipv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });
  if (octets.some((n) => !Number.isInteger(n) || n > 255)) return null;
  return octets;
}

/** loopback | blocked | public. Link-local and private ranges are always blocked. */
export function classifyIp(ip) {
  let value = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") return "loopback";
  const v4 = ipv4(value);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return "loopback";
    if (a === 10) return "blocked";
    if (a === 0) return "blocked";
    if (a === 169 && b === 254) return "blocked";
    if (a === 172 && b >= 16 && b <= 31) return "blocked";
    if (a === 192 && b === 168) return "blocked";
    if (a === 100 && b >= 64 && b <= 127) return "blocked";
    if (a >= 224) return "blocked";
    return "public";
  }
  if (value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) {
    return "blocked";
  }
  return "public";
}

export function ipAllowed(ip, allowLoopback) {
  const kind = classifyIp(ip);
  if (kind === "public") return true;
  if (kind === "loopback") return Boolean(allowLoopback);
  return false;
}

export async function assertPublicHttpUrl(urlString, { allowLoopback = false } = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new SsrfError("That is not a usable URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http and https pages can be watched");
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with a username or password are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host)) {
    if (!(allowLoopback && (host === "localhost" || host === "localhost.localdomain"))) {
      throw new SsrfError("That host is not allowed");
    }
  }
  if (isIP(host)) {
    if (!ipAllowed(host, allowLoopback)) throw new SsrfError("That address is not allowed");
    return url;
  }
  let records;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new SsrfError("Could not resolve that host");
  }
  if (records.length === 0 || records.some((record) => !ipAllowed(record.address, allowLoopback))) {
    throw new SsrfError("That host resolves to a blocked address");
  }
  return url;
}

export async function fetchPublic(urlString, options = {}) {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxBytes = options.maxBytes ?? 500_000;
  let current = urlString;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicHttpUrl(current, options);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "DriftlineBot/0.1 (public page watch; contact the site operator)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect without a location");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`Page responded ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (type && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
      await response.body?.cancel();
      throw new Error("Page is not HTML or text");
    }
    return readLimited(response, maxBytes);
  }
  throw new Error("Too many redirects");
}

async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Page is larger than 500 KB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function postJsonPublic(urlString, payload, options = {}) {
  await assertPublicHttpUrl(urlString, options);
  const response = await fetch(urlString, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    headers: {
      "content-type": "application/json",
      "user-agent": "DriftlineBot/0.1",
    },
    body: JSON.stringify(payload),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("Webhook redirects are not followed");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Webhook responded ${response.status}`);
  }
  await response.body?.cancel();
}

export function publicError(err) {
  if (err?.name === "SsrfError") return err.message;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "The page took too long to respond";
  const message = String(err?.message || "");
  if (/^(Page |Redirect |Webhook |Too many|Focus )/.test(message) || message.includes("not allowed") || message.includes("Only http")) {
    return message;
  }
  return "Could not read that page";
}
