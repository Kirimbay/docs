#!/usr/bin/env bash
# Восстановление хаба на новом IP/сервере
set -euo pipefail

BACKUP_FILE="${1:?Usage: restore-on-new-server.sh backup.tar.gz [encryption_password]}"
ENCRYPT_KEY="${2:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/install.sh

if [[ -n "$ENCRYPT_KEY" ]]; then
  hiddify-hub restore "$BACKUP_FILE" --encrypt "$ENCRYPT_KEY"
else
  hiddify-hub restore "$BACKUP_FILE"
fi

echo "Обновите public_url и base_url нод в config/servers.yaml если IP/домены изменились"
echo "Затем: hiddify-hub sync-all && hiddify-hub serve"
