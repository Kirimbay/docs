#!/usr/bin/env bash
# Production-safety checks: patch real Hiddify templates, Jinja-render, JSONC-parse.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$(mktemp -d)"
INST="$(mktemp -d)"
cleanup() { rm -rf "$TEST" "$INST"; }
trap cleanup EXIT

fetch() {
  local rel="$1"
  mkdir -p "$TEST/$(dirname "$rel")"
  curl -fsSL "https://raw.githubusercontent.com/hiddify/Hiddify-Manager/main/$rel" -o "$TEST/$rel"
}

echo "== fetching upstream Hiddify templates =="
fetch xray/configs/03_routing.json.j2
fetch xray/configs/06_outbounds.json.j2
fetch xray/configs/00_log.json.j2
fetch singbox/configs/03_routing.json.j2
cp "$TEST/xray/configs/03_routing.json.j2" "$TEST/xray/configs/03_routing.json"
cp "$TEST/xray/configs/06_outbounds.json.j2" "$TEST/xray/configs/06_outbounds.json"
cp "$TEST/xray/configs/00_log.json.j2" "$TEST/xray/configs/00_log.json"
cp "$TEST/singbox/configs/03_routing.json.j2" "$TEST/singbox/configs/03_routing.json"

export HIDDIFY_DIR="$TEST"
export NOTORRENT_INSTALL_DIR="$INST"
export SKIP_FIREWALL=1 SKIP_SYSTEMD=1 SKIP_ROOT=1

echo "== apply (1) =="
bash "$ROOT/scripts/hiddify-block-torrents.sh" apply

echo "== apply (2, idempotent) =="
bash "$ROOT/scripts/hiddify-block-torrents.sh" apply

echo "== jinja render + JSONC parse =="
python3 - "$TEST" <<'PY'
import json, re, sys
from pathlib import Path
from jinja2 import Environment, BaseLoader

root = Path(sys.argv[1])

def jsonc_loads(text, name):
    out, i, n, in_str, esc = [], 0, len(text), False, False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    s = "".join(out)
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r",(\s*[\]}])", r"\1", s)
    try:
        return json.loads(s)
    except Exception as e:
        print(f"JSON FAIL {name}: {e}")
        raise

def exec_fn(cmd):
    if "ip -o -4" in cmd:
        return '"10.0.0.1"'
    return ""

class Cfg(dict):
    def __getitem__(self, k):
        return dict.__getitem__(self, k)
    def get(self, k, default=""):
        return dict.get(self, k, default)

variants = [
    Cfg(warp_mode="disable", country="ru", block_iran_sites=False,
        log_level="WARNING", only_ipv4=False, warp_sites=""),
    Cfg(warp_mode="all", country="ir", block_iran_sites=True,
        log_level="CRITICAL", only_ipv4=True, warp_sites="example.com"),
    Cfg(warp_mode="enable", country="cn", block_iran_sites=False,
        log_level="ERROR", only_ipv4=False, warp_sites=""),
]

env = Environment(loader=BaseLoader(), autoescape=False)
files = [
    "xray/configs/03_routing.json.j2",
    "xray/configs/06_outbounds.json.j2",
    "xray/configs/00_log.json.j2",
    "singbox/configs/03_routing.json.j2",
]

for cfg in variants:
    label = f"warp={cfg['warp_mode']} country={cfg['country']} log={cfg['log_level']}"
    for rel in files:
        src = (root / rel).read_text()
        rendered = env.from_string(src).render(hconfigs=cfg, exec=exec_fn)
        data = jsonc_loads(rendered, f"{rel} [{label}]")
        if "outbounds" in data:
            tags = [o.get("tag") for o in data["outbounds"]]
            assert tags[0] != "blocked_torrent", f"blocked_torrent first outbound! {tags}"
            assert "freedom" in tags
            assert "blocked_torrent" in tags
            assert "blackhole" in tags
        if "routing" in data:
            rules = data["routing"]["rules"]
            assert rules[-1].get("port") == "0-65535", rules[-1]
            last_tag = rules[-1]["outboundTag"]
            assert last_tag in ("freedom", "WARP"), last_tag
            bt_tags = [r.get("outboundTag") for r in rules if r.get("protocol") == ["bittorrent"] or "bittorrent" in (r.get("protocol") or [])]
            assert "blocked_torrent" in [r.get("outboundTag") for r in rules]
            # catch-all after our block
            idx_bt = next(i for i, r in enumerate(rules) if r.get("outboundTag") == "blocked_torrent")
            idx_all = next(i for i, r in enumerate(rules) if r.get("port") == "0-65535")
            assert idx_bt < idx_all
        if "route" in data:
            assert data["route"]["final"] in ("freedom", "WARP")
            protos = [r.get("protocol") for r in data["route"]["rules"]]
            assert "bittorrent" in protos
            sniff = data["route"]["rules"][0]
            assert sniff.get("action") == "sniff"
        if "log" in data:
            assert "loglevel" in data["log"]
    print("render ok:", label)

print("all variant renders ok")
PY

echo "== first outbound is not blocked_torrent =="
python3 - <<PY
from pathlib import Path
t = Path("$TEST/xray/configs/06_outbounds.json.j2").read_text()
assert t.find('"tag": "freedom"') < t.find('"tag": "blocked_torrent"') or t.find('"tag":"freedom"') < t.find("blocked_torrent")
# blocked_torrent must appear after stock blackhole
assert t.find('"tag": "blackhole"') < t.find("blocked_torrent")
print("outbound order ok")
PY

echo "== status =="
bash "$ROOT/scripts/hiddify-block-torrents.sh" status | head -20

echo "PROD CHECKS OK"
