#!/usr/bin/env bash
# One-shot migrate helper: pack data on THIS host for copy to a new VPS.
# Prints next steps for the destination machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-/root/sarafan-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"

bash "$ROOT/backup.sh" "$OUT"

cat <<EOF

Next steps on the NEW machine:
  1) Install Node + copy app (or run remote-install.sh)
  2) scp $OUT root@NEW_HOST:/root/
  3) On NEW_HOST:
       bash /opt/komnata/deploy/restore.sh /root/$(basename "$OUT")
       # or from repo:
       DATA_DIR=/var/lib/komnata bash anon-chat/deploy/restore.sh /root/$(basename "$OUT")
  4) Point DNS A-record to the new IP
  5) Issue TLS cert / reload HAProxy as before

Important: this archive includes vapid.json — keep it so existing
push subscriptions continue to work after the move.
EOF
