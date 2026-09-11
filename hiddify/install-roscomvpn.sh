#!/bin/bash
# Install RoscomVPN Happ/INCY routing + Cloudflare ping URL into Hiddify Manager.
#
# One-liner on a Hiddify server (as root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/main/hiddify/install-roscomvpn.sh)
#
# From your laptop against many servers:
#   bash install-roscomvpn.sh root@10.0.0.1 root@10.0.0.2
#   bash install-roscomvpn.sh -f hosts.txt
#
# hosts.txt: one SSH target per line, comments (#) allowed.
set -euo pipefail

REMOTE_MODE=0
HOSTS=()
HOSTS_FILE=""

usage() {
  sed -n '2,16p' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    -f|--file) HOSTS_FILE="${2:?}"; shift 2 ;;
    --local) shift ;;
    -*) echo "Unknown option: $1" >&2; usage 1 ;;
    *) HOSTS+=("$1"); shift ;;
  esac
done

if [[ -n "$HOSTS_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    HOSTS+=("$line")
  done < "$HOSTS_FILE"
fi

if [[ ${#HOSTS[@]} -gt 0 ]]; then
  SELF="$(readlink -f "$0" 2>/dev/null || python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$0")"
  fail=0
  i=0
  for host in "${HOSTS[@]}"; do
    i=$((i+1))
    echo "======== [$i/${#HOSTS[@]}] $host ========"
    if scp -o StrictHostKeyChecking=accept-new "$SELF" "$host:/tmp/install-hiddify-roscomvpn.sh" \
      && ssh -o StrictHostKeyChecking=accept-new "$host" "bash /tmp/install-hiddify-roscomvpn.sh"; then
      echo "OK $host"
    else
      echo "FAILED $host" >&2
      fail=1
    fi
  done
  exit "$fail"
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the Hiddify server, or pass SSH targets." >&2
  exit 1
fi

if [[ ! -d /opt/hiddify-manager ]]; then
  echo "Hiddify Manager not found at /opt/hiddify-manager" >&2
  exit 1
fi

SITE="$(python3 - << 'PY'
from pathlib import Path
root = Path("/opt/hiddify-manager")
cands = []
for p in root.glob(".venv*/lib/python*/site-packages"):
    if (p / "hiddifypanel/panel/user/user.py").is_file():
        cands.append(p)
if not cands:
    raise SystemExit("hiddifypanel not found in any venv")
# Prefer the venv that is actually used if present
print(sorted(cands, key=lambda p: p.stat().st_mtime)[-1])
PY
)"

echo "Using site-packages: $SITE"
mkdir -p /opt/hiddify-custom/cache

cat > /opt/hiddify-custom/hiddify_roscomvpn.py << 'PY'
"""Inject RoscomVPN Happ/INCY routing into Hiddify subscription responses."""
from __future__ import annotations

import re
import threading
import time
import urllib.request
from pathlib import Path

CACHE_DIR = Path("/opt/hiddify-custom/cache")
TTL_OK = 600
TTL_FAIL = 30

URLS = {
    "happ": "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/HAPP/DEFAULT.DEEPLINK",
    "incy": "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/INCY/DEFAULT.DEEPLINK",
}

_lock = threading.Lock()
_state: dict[str, dict] = {
    key: {"value": "", "fetched_at": 0.0, "last_fail": 0.0} for key in URLS
}


def _read_disk(key: str) -> str:
    p = CACHE_DIR / f"{key}.deeplink"
    try:
        return p.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _write_disk(key: str, value: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / f"{key}.deeplink"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(value + "\n", encoding="utf-8")
    tmp.replace(p)


def _http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "hiddify-roscomvpn/1.0"})
    with urllib.request.urlopen(req, timeout=6) as resp:
        return resp.read().decode("utf-8", errors="replace")


def get_deeplink(kind: str) -> str:
    spec = URLS[kind]
    st = _state[kind]
    now = time.monotonic()
    if st["value"] and (now - st["fetched_at"]) < TTL_OK:
        return _optional(st["value"])
    if st["last_fail"] and (now - st["last_fail"]) < TTL_FAIL:
        return _optional(st["value"] or _read_disk(kind))
    with _lock:
        now = time.monotonic()
        if st["value"] and (now - st["fetched_at"]) < TTL_OK:
            return _optional(st["value"])
        try:
            value = _http_get(spec).strip()
            if not value or "://" not in value:
                raise ValueError("empty or invalid deeplink")
            st["value"] = value
            st["fetched_at"] = now
            st["last_fail"] = 0.0
            _write_disk(kind, value)
            return _optional(value)
        except Exception:
            st["last_fail"] = now
            cached = st["value"] or _read_disk(kind)
            st["value"] = cached
            return _optional(cached)


def _optional(deeplink: str) -> str:
    """Use add (not onadd) so Happ/INCY do not force-lock the routing toggle."""
    if not deeplink:
        return ""
    return deeplink.replace("://routing/onadd/", "://routing/add/", 1)


def kind_for_ua(ua: str) -> str:
    if re.search(r"incy", ua or "", re.IGNORECASE):
        return "incy"
    return "happ"


def attach_routing_headers(resp) -> None:
    try:
        from flask import request
        ua = (request.headers.get("User-Agent") or "") if request else ""
    except Exception:
        ua = ""
    deeplink = get_deeplink(kind_for_ua(ua))
    if not deeplink:
        return
    resp.headers["routing"] = deeplink
PY

cat > /opt/hiddify-custom/apply-subscription-patches.py << 'PY'
#!/usr/bin/env python3
from pathlib import Path
import shutil
import sys

def find_site() -> Path:
    root = Path("/opt/hiddify-manager")
    cands = [p for p in root.glob(".venv*/lib/python*/site-packages")
             if (p / "hiddifypanel/panel/user/user.py").is_file()]
    if not cands:
        print("ERROR: hiddifypanel not found", file=sys.stderr)
        sys.exit(1)
    return sorted(cands, key=lambda p: p.stat().st_mtime)[-1]

SITE = find_site()
SRC = Path("/opt/hiddify-custom/hiddify_roscomvpn.py")
shutil.copy2(SRC, SITE / "hiddify_roscomvpn.py")

USER_PY = SITE / "hiddifypanel/panel/user/user.py"
SINGBOX = SITE / "hiddifypanel/hutils/proxy/singbox.py"
user = USER_PY.read_text(encoding="utf-8")

force = """        ua = request.user_agent.string
        if re.match(r'^(Happ|INCY)/', ua, re.IGNORECASE):
            return self.xray()
        if g.user_agent['is_singbox'] or re.match('^(HiddifyNext|Dart|SFI|SFA)', ua, re.IGNORECASE):
"""
orig = """        ua = request.user_agent.string
        if g.user_agent['is_singbox'] or re.match('^(HiddifyNext|Dart|SFI|SFA)', ua, re.IGNORECASE):
"""
if force in user:
    user = user.replace(force, orig, 1)

old_test = '    resp.headers[\'test-url\'] = "https://www.gstatic.com/generate_204"\n'
new_test = '''    resp.headers['test-url'] = "https://cp.cloudflare.com/generate_204"
    try:
        from hiddify_roscomvpn import attach_routing_headers
        attach_routing_headers(resp)
    except Exception:
        pass
'''
if "hiddify_roscomvpn import attach_routing_headers" not in user:
    if old_test in user:
        user = user.replace(old_test, new_test, 1)
    else:
        cf = '    resp.headers[\'test-url\'] = "https://cp.cloudflare.com/generate_204"\n'
        if cf in user and "hiddify_roscomvpn" not in user:
            user = user.replace(cf, new_test, 1)
        elif "hiddify_roscomvpn" not in user:
            print("ERROR: test-url line not found in user.py", file=sys.stderr)
            sys.exit(1)

USER_PY.write_text(user, encoding="utf-8")

if SINGBOX.is_file():
    sb = SINGBOX.read_text(encoding="utf-8")
    sb2 = sb.replace("https://www.gstatic.com/generate_204", "https://cp.cloudflare.com/generate_204")
    if sb2 != sb:
        SINGBOX.write_text(sb2, encoding="utf-8")

print("subscription patches applied:", SITE)
PY
chmod 755 /opt/hiddify-custom/apply-subscription-patches.py

# Keep a copy of this installer next to the patches
cp -f "$(readlink -f "$0" 2>/dev/null || echo "$0")" /opt/hiddify-custom/install-hiddify-roscomvpn.sh 2>/dev/null || true
chmod 755 /opt/hiddify-custom/install-hiddify-roscomvpn.sh 2>/dev/null || true

python3 /opt/hiddify-custom/apply-subscription-patches.py

# Prefetch deeplinks (optional; panel will fetch on first request anyway)
python3 - << 'PY' || true
import sys
sys.path.insert(0, "/opt/hiddify-custom")
from hiddify_roscomvpn import get_deeplink
for k in ("happ", "incy"):
    v = get_deeplink(k)
    print(k, "ok" if v else "EMPTY", "len", len(v))
PY

PANEL_USER="hiddify-panel"
if getent passwd hiddify-panel >/dev/null; then
  chown -R hiddify-panel:hiddify-panel /opt/hiddify-custom/cache
fi

mkdir -p /etc/systemd/system/hiddify-panel.service.d
cat > /etc/systemd/system/hiddify-panel.service.d/roscomvpn.conf << 'EOF'
[Service]
ExecStartPre=+/usr/bin/python3 /opt/hiddify-custom/apply-subscription-patches.py
EOF

systemctl daemon-reload
systemctl restart hiddify-panel
sleep 2
systemctl is-active hiddify-panel

echo
echo "Done. Cloudflare test-url + optional RoscomVPN routing (Happ/INCY) are installed."
echo "Users must refresh the subscription. Routing toggle stays user-controlled."
