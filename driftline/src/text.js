import { createHash } from "node:crypto";

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Visible text only. Script and style bodies are dropped so they cannot fake a change. */
export function visibleText(html) {
  const source = String(html ?? "");
  const stripped = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity) => decodeEntity(entity))
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function decodeEntity(entity) {
  const body = entity.slice(1, -1);
  if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? " ";
  const code = body[1] === "x" || body[1] === "X"
    ? Number.parseInt(body.slice(2), 16)
    : Number.parseInt(body.slice(1), 10);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return " ";
  return String.fromCodePoint(code);
}

/**
 * If focus is set, keep the slice that starts at that phrase.
 * Returns found:false when the phrase is missing.
 */
export function focusSlice(text, focus) {
  const needle = String(focus ?? "").trim();
  if (!needle) return { found: true, text: String(text ?? "") };
  const hay = String(text ?? "");
  const at = hay.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return { found: false, text: "" };
  return { found: true, text: hay.slice(at, at + 4000) };
}

export function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

/** Word-level diff capped at 120 words per side so a huge page cannot stall a request. */
export function wordDiff(before, after) {
  const aw = String(before ?? "").split(/\s+/).filter(Boolean).slice(0, 120);
  const bw = String(after ?? "").split(/\s+/).filter(Boolean).slice(0, 120);
  const dp = Array.from({ length: aw.length + 1 }, () => new Uint16Array(bw.length + 1));
  for (let i = aw.length - 1; i >= 0; i -= 1) {
    for (let j = bw.length - 1; j >= 0; j -= 1) {
      dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < aw.length && j < bw.length) {
    if (aw[i] === bw[j]) {
      out.push({ t: "same", w: bw[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: "del", w: aw[i] });
      i += 1;
    } else {
      out.push({ t: "add", w: bw[j] });
      j += 1;
    }
  }
  while (i < aw.length) out.push({ t: "del", w: aw[i++] });
  while (j < bw.length) out.push({ t: "add", w: bw[j++] });
  return out;
}
