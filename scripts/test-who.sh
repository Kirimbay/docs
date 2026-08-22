#!/usr/bin/env bash
# Offline check that who reads MariaDB-style sqlite users and torrent access logs,
# and that doctor / version exist.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$(mktemp -d)"
cleanup() { rm -rf "$TEST"; }
trap cleanup EXIT

mkdir -p "$TEST/hiddify-panel" "$TEST/xray/configs" "$TEST/log/system"
printf '%s\n' '{"inbounds":[],"outbounds":[],"routing":{"rules":[{"port":"0-65535","outboundTag":"blocked_torrent"}]}}' \
  > "$TEST/xray/configs/03_routing.json"

python3 - "$TEST/hiddify-panel/hiddifypanel.db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("CREATE TABLE user (uuid TEXT, name TEXT, current_usage INTEGER)")
con.execute(
    "INSERT INTO user VALUES (?,?,?)",
    ("11111111-1111-1111-1111-111111111111", "alice", 10 * 1024 ** 3),
)
con.commit()
con.close()
PY

printf '%s\n' \
  '2026-08-22 12:00:00 accepted tcp:1.2.3.4:51413 email: 11111111-1111-1111-1111-111111111111@hiddify.com outbound: blocked_torrent' \
  > "$TEST/log/system/xray.access.log"

unset NOTORRENT_INSTALL_DIR
export HIDDIFY_DIR="$TEST"
export SKIP_ROOT=1 SKIP_FIREWALL=1 SKIP_SYSTEMD=1

ver="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" version)"
[[ "${ver}" == "1.4.1" ]] || { echo "version mismatch: ${ver}"; exit 1; }

who_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" who)"
printf '%s\n' "${who_out}"
echo "${who_out}" | grep -q 'alice' || { echo "who missed panel user"; exit 1; }
echo "${who_out}" | grep -q '10.0 GB' || { echo "who missed usage"; exit 1; }
echo "${who_out}" | grep -q 'sqlite' || { echo "who missed sqlite source"; exit 1; }
echo "${who_out}" | grep -q 'срабатываний' || { echo "who missed access-log hit"; exit 1; }

doc_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" doctor)"
printf '%s\n' "${doc_out}"
echo "${doc_out}" | grep -q 'catch-all:   blocked_torrent' || { echo "doctor missed catch-all"; exit 1; }
echo "${doc_out}" | grep -q '1.4.1' || { echo "doctor missed version"; exit 1; }

help_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" help)"
echo "${help_out}" | grep -q doctor || { echo "help missing doctor"; exit 1; }

# URI parser used for modern MariaDB panels
python3 - <<'PY'
from urllib.parse import unquote, urlparse
uri = "mysql+mysqldb://hiddifypanel:p%40ss@localhost/hiddifypanel?charset=utf8mb4"
raw = uri.split("://", 1)[-1]
parsed = urlparse("mysql://" + raw)
assert unquote(parsed.username) == "hiddifypanel"
assert unquote(parsed.password) == "p@ss"
assert parsed.hostname == "localhost"
assert (parsed.path or "").lstrip("/") == "hiddifypanel"
print("uri parse ok")
PY

echo "who/doctor tests ok"
