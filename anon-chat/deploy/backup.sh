#!/usr/bin/env bash
# Backup Сарафан data (history, photos, VAPID, push subscriptions).
# Usage:
#   bash anon-chat/deploy/backup.sh
#   bash anon-chat/deploy/backup.sh /path/to/sarafan-backup.tar.gz
#   DATA_DIR=/var/lib/komnata bash anon-chat/deploy/backup.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/komnata}"
APP_DIR="${APP_DIR:-/opt/komnata}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-./sarafan-backup-${STAMP}.tar.gz}"
OUT="$(readlink -f "$OUT" 2>/dev/null || realpath "$OUT" 2>/dev/null || echo "$OUT")"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "Data dir not found: $DATA_DIR" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/sarafan"

echo "==> copying data from $DATA_DIR"
cp -a "$DATA_DIR/." "$TMP/sarafan/data/"

# Capture service secrets so restore works on a fresh machine.
mkdir -p "$TMP/sarafan/meta"
if [[ -f /etc/systemd/system/komnata.service ]]; then
  cp -a /etc/systemd/system/komnata.service "$TMP/sarafan/meta/komnata.service"
elif [[ -f "$APP_DIR/../komnata.service" ]]; then
  cp -a "$APP_DIR/../komnata.service" "$TMP/sarafan/meta/komnata.service" 2>/dev/null || true
fi

{
  echo "createdAt=$STAMP"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
  echo "dataDir=$DATA_DIR"
  echo "appDir=$APP_DIR"
  if command -v du >/dev/null 2>&1; then
    echo "dataBytes=$(du -sb "$DATA_DIR" 2>/dev/null | awk '{print $1}')"
  fi
  if [[ -f "$DATA_DIR/store.json" ]]; then
    echo "messages=$(grep -o '"id"' "$DATA_DIR/store.json" 2>/dev/null | wc -l | tr -d ' ')"
  fi
} > "$TMP/sarafan/meta/backup.env"

mkdir -p "$(dirname "$OUT")"
tar -C "$TMP" -czf "$OUT" sarafan
BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo "==> backup ready: $OUT ($BYTES bytes)"
echo "    Keep this file + remember ADMIN_PASSWORD from komnata.service"
