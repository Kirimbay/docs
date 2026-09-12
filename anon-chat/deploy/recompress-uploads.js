#!/usr/bin/env node
/**
 * Recompress existing uploads to WebP to reclaim disk space.
 * Usage (on server):
 *   cd /opt/komnata && node deploy/recompress-uploads.js
 * Dry run:
 *   DRY_RUN=1 node deploy/recompress-uploads.js
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const APP_DIR = path.join(__dirname, "..");
const DATA_DIR = fs.existsSync(path.join(APP_DIR, "data"))
  ? fs.realpathSync(path.join(APP_DIR, "data"))
  : path.join(APP_DIR, "data");
const UPLOAD_DIR = fs.existsSync(path.join(APP_DIR, "uploads"))
  ? fs.realpathSync(path.join(APP_DIR, "uploads"))
  : path.join(APP_DIR, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const IMAGE_MAX_PX = Number(process.env.IMAGE_MAX_PX) || 1080;
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY) || 52;
const DRY_RUN = process.env.DRY_RUN === "1";

async function compressFile(filePath) {
  const input = await fs.promises.readFile(filePath);
  const out = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: IMAGE_MAX_PX,
      height: IMAGE_MAX_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY, effort: 5, smartSubsample: true })
    .toBuffer();
  return out;
}

async function main() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.error("uploads dir missing:", UPLOAD_DIR);
    process.exit(1);
  }
  const store = fs.existsSync(STORE_PATH)
    ? JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))
    : { messages: [], pinnedIds: [] };

  const files = (await fs.promises.readdir(UPLOAD_DIR)).filter((f) =>
    /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f)
  );

  let saved = 0;
  let touched = 0;
  const renameMap = new Map();

  for (const name of files) {
    if (name.endsWith(".webp") && !process.env.FORCE_WEBP) {
      // Already webp — optionally recompress if much larger than target.
      const full = path.join(UPLOAD_DIR, name);
      const st = await fs.promises.stat(full);
      if (st.size < 180_000) continue;
    }
    const full = path.join(UPLOAD_DIR, name);
    const before = (await fs.promises.stat(full)).size;
    try {
      const out = await compressFile(full);
      if (out.length >= before * 0.95) {
        console.log(`skip ${name}: no gain (${before} → ${out.length})`);
        continue;
      }
      const base = name.replace(/\.[^.]+$/, "");
      const nextName = `${base}.webp`;
      const nextPath = path.join(UPLOAD_DIR, nextName);
      if (!DRY_RUN) {
        await fs.promises.writeFile(nextPath, out);
        if (nextName !== name) await fs.promises.unlink(full);
      }
      renameMap.set(`/uploads/${name}`, `/uploads/${nextName}`);
      saved += before - out.length;
      touched += 1;
      console.log(`${DRY_RUN ? "[dry] " : ""}${name} → ${nextName}: ${before} → ${out.length}`);
    } catch (err) {
      console.warn(`fail ${name}:`, err.message);
    }
  }

  if (renameMap.size && !DRY_RUN) {
    let changed = 0;
    for (const msg of store.messages || []) {
      if (msg.imageUrl && renameMap.has(msg.imageUrl)) {
        msg.imageUrl = renameMap.get(msg.imageUrl);
        changed += 1;
      }
    }
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
    console.log(`store.json updated (${changed} image urls)`);
  }

  console.log(
    `done: ${touched} files, saved ~${Math.round(saved / 1024)} KiB${DRY_RUN ? " (dry-run)" : ""}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
