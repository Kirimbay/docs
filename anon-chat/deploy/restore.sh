#!/usr/bin/env bash
# Restore Сарафан backup onto this machine (history, photos, keys).
# Usage:
#   bash anon-chat/deploy/restore.sh ./sarafan-backup-YYYYMMDD.tar.gz
# Optional env:
#   DATA_DIR=/var/lib/komnata APP_DIR=/opt/komnata
set -euo pipefail

ARCHIVE="${1:?usage: $0 /path/to/sarafan-backup.tar.gz}"
DATA_DIR="${DATA_DIR:-/var/lib/komnata}"
APP_DIR="${APP_DIR:-/opt/komnata}"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> extracting $ARCHIVE"
tar -C "$TMP" -xzf "$ARCHIVE"
if [[ ! -d "$TMP/sarafan/data" ]]; then
  echo "Invalid backup: missing sarafan/data" >&2
  exit 1
fi

echo "==> stopping komnata (if installed)"
systemctl stop komnata 2>/dev/null || true

echo "==> restoring into $DATA_DIR"
mkdir -p "$DATA_DIR"
# Replace contents but keep the directory node (and any mount).
rm -rf "${DATA_DIR:?}/"*
cp -a "$TMP/sarafan/data/." "$DATA_DIR/"
mkdir -p "$DATA_DIR/uploads"

if [[ -d "$APP_DIR" ]]; then
  echo "==> fixing app symlinks in $APP_DIR"
  ln -sfn "$DATA_DIR/uploads" "$APP_DIR/uploads"
  ln -sfn "$DATA_DIR" "$APP_DIR/data"
fi

if [[ -f "$TMP/sarafan/meta/komnata.service" ]]; then
  echo "==> note: backup includes komnata.service (ADMIN_PASSWORD etc.)"
  echo "    To reuse it: cp $TMP/sarafan/meta/komnata.service /etc/systemd/system/ && systemctl daemon-reload"
  cp -a "$TMP/sarafan/meta/komnata.service" /root/komnata.service.from-backup 2>/dev/null || true
fi

if [[ -f "$TMP/sarafan/meta/backup.env" ]]; then
  echo "==> backup meta:"
  cat "$TMP/sarafan/meta/backup.env"
fi

echo "==> starting komnata (if installed)"
systemctl start komnata 2>/dev/null || true
sleep 1
systemctl is-active komnata 2>/dev/null || echo "(service not active yet — install app first, then start)"
echo "==> restore done"
