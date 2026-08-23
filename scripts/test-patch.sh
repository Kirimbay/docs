#!/usr/bin/env bash
# Offline check that routing patches apply to bundled Hiddify-like fixtures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$(mktemp -d)"
INST="$(mktemp -d)"
cleanup() { rm -rf "$TEST" "$INST"; }
trap cleanup EXIT

mkdir -p "$TEST/xray/configs" "$TEST/singbox/configs"
cp "$ROOT/scripts/fixtures/xray_03_routing.json.j2" "$TEST/xray/configs/03_routing.json.j2"
cp "$ROOT/scripts/fixtures/singbox_03_routing.json.j2" "$TEST/singbox/configs/03_routing.json.j2"
cp "$ROOT/scripts/fixtures/xray_00_log.json.j2" "$TEST/xray/configs/00_log.json.j2"
cp "$ROOT/scripts/fixtures/xray_06_outbounds.json.j2" "$TEST/xray/configs/06_outbounds.json.j2"

export HIDDIFY_DIR="$TEST"
export NOTORRENT_INSTALL_DIR="$INST"
export SKIP_FIREWALL=1 SKIP_SYSTEMD=1 SKIP_ROOT=1

bash "$ROOT/scripts/hiddify-block-torrents.sh" apply >/tmp/hiddify-notorrent-test.log

grep -q HIDDIFY_NOTORRENT_BEGIN "$TEST/xray/configs/03_routing.json.j2"
grep -q HIDDIFY_NOTORRENT_BEGIN "$TEST/singbox/configs/03_routing.json.j2"
grep -q '"protocol": \["bittorrent"\]' "$TEST/xray/configs/03_routing.json.j2"
grep -q '"protocol": "bittorrent"' "$TEST/singbox/configs/03_routing.json.j2"
grep -q '"tag": "blocked_torrent"' "$TEST/xray/configs/06_outbounds.json.j2"
grep -q 'xray.access.log' "$TEST/xray/configs/00_log.json.j2"
grep -q 'outboundTag": "blocked_torrent"' "$TEST/xray/configs/03_routing.json.j2"
# stock Hiddify BT rule retagged for access logs
grep -q 'outboundTag": "blocked_torrent".*"protocol": \["bittorrent"\]' "$TEST/xray/configs/03_routing.json.j2"
# catch-all still after our block
python3 - <<PY
from pathlib import Path
x = Path("$TEST/xray/configs/03_routing.json.j2").read_text()
assert x.index("HIDDIFY_NOTORRENT_BEGIN") < x.index('"0-65535"')
assert '"80,443' in x
# leftover ports must not go to freedom
import re as _re
cm = _re.search(r'"port":\s*"0-65535"[\s\S]{0,80}"outboundTag":\s*"([^"]+)"', x)
assert cm and cm.group(1) == "blocked_torrent", cm.group(1) if cm else None
s = Path("$TEST/singbox/configs/03_routing.json.j2").read_text()
assert "Block BitTorrent protocol" not in s  # stub removed
assert s.index("HIDDIFY_NOTORRENT_BEGIN") > s.index("ip_is_private")
assert '"action": "reject"' in s
PY

# idempotent
bash "$ROOT/scripts/hiddify-block-torrents.sh" apply >/dev/null
test "$(grep -c HIDDIFY_NOTORRENT_BEGIN "$TEST/xray/configs/03_routing.json.j2")" -eq 1
test "$(grep -c HIDDIFY_NOTORRENT_BEGIN "$TEST/singbox/configs/03_routing.json.j2")" -eq 1
# Live sing-box JSON sometimes flips key order or drops the compact reject object.
ALT="$(mktemp -d)"
mkdir -p "$ALT/singbox/configs" "$ALT/xray/configs"
cat > "$ALT/singbox/configs/03_routing.json" <<'JSON'
{
  "route": {
    "final": "freedom",
    "rules": [
      {"action":"sniff"},
      {"action":"hijack-dns","port":[53]},
      {"ip_is_private": true, "action": "reject"}
    ]
  }
}
JSON
cp "$TEST/xray/configs/03_routing.json.j2" "$ALT/xray/configs/03_routing.json.j2"
cp "$TEST/xray/configs/06_outbounds.json.j2" "$ALT/xray/configs/06_outbounds.json.j2"
cp "$TEST/xray/configs/00_log.json.j2" "$ALT/xray/configs/00_log.json.j2"
HIDDIFY_DIR="$ALT" NOTORRENT_INSTALL_DIR="$(mktemp -d)" \
  bash "$ROOT/scripts/hiddify-block-torrents.sh" apply >/dev/null
grep -q HIDDIFY_NOTORRENT_BEGIN "$ALT/singbox/configs/03_routing.json"
grep -q '"protocol": "bittorrent"' "$ALT/singbox/configs/03_routing.json"
rm -rf "$ALT"
# Live JSON missing comma before our block (Hiddify re-render). Must stay valid JSONC.
BROKEN="$(mktemp -d)"
mkdir -p "$BROKEN/singbox/configs" "$BROKEN/xray/configs"
cat > "$BROKEN/singbox/configs/03_routing.json" <<'JSON'
{
  "route": {
    "final": "freedom",
    "rules": [
      {"action":"sniff"},
      {
        "action": "reject",
        "ip_is_private": true
      }
            // HIDDIFY_NOTORRENT_BEGIN
            {
              "protocol": "bittorrent",
              "action": "reject",
              "method": "default"
            },
            {
              "action": "reject",
              "method": "default"
            },
            // HIDDIFY_NOTORRENT_END
    ]
  }
}
JSON
cp "$TEST/xray/configs/03_routing.json.j2" "$BROKEN/xray/configs/03_routing.json.j2"
cp "$TEST/xray/configs/06_outbounds.json.j2" "$BROKEN/xray/configs/06_outbounds.json.j2"
cp "$TEST/xray/configs/00_log.json.j2" "$BROKEN/xray/configs/00_log.json.j2"
HIDDIFY_DIR="$BROKEN" NOTORRENT_INSTALL_DIR="$(mktemp -d)" \
  bash "$ROOT/scripts/hiddify-block-torrents.sh" apply >/dev/null
python3 - "$BROKEN/singbox/configs/03_routing.json" <<'PY'
import json, re, sys
from pathlib import Path
t = Path(sys.argv[1]).read_text()
assert re.search(r',\s*//\s*HIDDIFY_NOTORRENT_BEGIN', t), t[t.find("ip_is_private")-20:t.find("ip_is_private")+200]
json.loads(re.sub(r"//.*?$", "", t, flags=re.M))
print("comma repair ok")
PY
rm -rf "$BROKEN"
echo "patch tests ok"
