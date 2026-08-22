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
[[ "${ver}" == "1.7.1" ]] || { echo "version mismatch: ${ver}"; exit 1; }

who_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" who)"
printf '%s\n' "${who_out}"
echo "${who_out}" | grep -q 'alice' || { echo "who missed panel user"; exit 1; }
echo "${who_out}" | grep -q '10.0 GB' || { echo "who missed usage"; exit 1; }
echo "${who_out}" | grep -q 'sqlite' || { echo "who missed sqlite source"; exit 1; }
echo "${who_out}" | grep -q 'срабатываний' || { echo "who missed access-log hit"; exit 1; }

doc_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" doctor)"
printf '%s\n' "${doc_out}"
echo "${doc_out}" | grep -q 'catch-all:   blocked_torrent' || { echo "doctor missed catch-all"; exit 1; }
echo "${doc_out}" | grep -q '1.7.1' || { echo "doctor missed version"; exit 1; }

# leak verdict from a dump that matches the user's server (DNS only + UNCONN listeners)
ss_dump="${TEST}/ss.txt"
cat > "${ss_dump}" <<'SS'
udp   UNCONN 0 0 0.0.0.0:39293 0.0.0.0:* users:(("xray",pid=153457,fd=8))
udp   ESTAB  0 0 10.0.0.5:53122 1.1.1.1:53 users:(("hiddify-core",pid=35885,fd=9))
SS
export NOTORRENT_SS_DUMP="${ss_dump}"
leak_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" doctor)"
echo "${leak_out}" | grep -q 'verdict:' || { echo "doctor missed leak verdict"; echo "${leak_out}"; exit 1; }
echo "${leak_out}" | grep -q 'OUTPUT allowlist' || { echo "doctor missed 1.5 hint"; echo "${leak_out}"; exit 1; }

preview="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" nft-preview)"
echo "${preview}" | grep -q 'ct state new counter drop' || { echo "nft preview missing NEW drop"; echo "${preview}"; exit 1; }
echo "${preview}" | grep -q 'inspect_web' || { echo "nft preview missing inspect_web"; echo "${preview}"; exit 1; }
echo "${preview}" | grep -q 'chain fw' || { echo "nft preview missing fw chain"; echo "${preview}"; exit 1; }
if echo "${preview}" | grep -qE 'chain fwd'; then
  echo "nft chain name 'fwd' is reserved and rejects the whole table"
  echo "${preview}"
  exit 1
fi
echo "${preview}" | grep -q 'priority 10' || { echo "nft preview must be after conntrack"; echo "${preview}"; exit 1; }
echo "${preview}" | grep -q 'ipv6-icmp' || { echo "nft preview missing ipv6-icmp"; echo "${preview}"; exit 1; }
if echo "${preview}" | grep -qE '^\s+counter drop$'; then
  echo "nft preview still leftover-drops UNTRACKED"
  echo "${preview}"
  exit 1
fi

# fake torrent peers through xray — must NOT say leak
cat > "${ss_dump}" <<'SS'
udp   ESTAB 0 0 10.0.0.5:41000 203.0.113.9:51413 users:(("xray",pid=1,fd=3))
tcp   ESTAB 0 0 10.0.0.5:41001 198.51.100.4:6881 users:(("xray",pid=1,fd=4))
SS
thru_out="$(bash "$ROOT/scripts/hiddify-block-torrents.sh" doctor)"
echo "${thru_out}" | grep -q '2 исходящих' || { echo "doctor missed through-server peers"; echo "${thru_out}"; exit 1; }
if echo "${thru_out}" | grep -q 'verdict:'; then
  echo "false leak verdict"
  echo "${thru_out}"
  exit 1
fi

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
