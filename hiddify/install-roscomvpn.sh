#!/bin/bash
# Install RoscomVPN Happ/INCY routing + Cloudflare ping URL into Hiddify Manager.
#
# Install (Hiddify server, root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-roscomvpn-install-48ca/hiddify/install-roscomvpn.sh)
#
# Uninstall (stock Hiddify subscription headers):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-roscomvpn-install-48ca/hiddify/install-roscomvpn.sh) --uninstall
#
# Many servers:
#   bash install-roscomvpn.sh root@10.0.0.1 root@10.0.0.2
#   bash install-roscomvpn.sh --uninstall -f hosts.txt
set -euo pipefail

HOSTS=()
HOSTS_FILE=""
UNINSTALL=0

usage() {
  sed -n '2,14p' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    -f|--file) HOSTS_FILE="${2:?}"; shift 2 ;;
    --uninstall|-u) UNINSTALL=1; shift ;;
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
  extra=()
  [[ "$UNINSTALL" == 1 ]] && extra+=(--uninstall)
  fail=0
  i=0
  for host in "${HOSTS[@]}"; do
    i=$((i+1))
    echo "======== [$i/${#HOSTS[@]}] $host ========"
    if scp -o StrictHostKeyChecking=accept-new "$SELF" "$host:/tmp/install-hiddify-roscomvpn.sh" \
      && ssh -o StrictHostKeyChecking=accept-new "$host" "bash /tmp/install-hiddify-roscomvpn.sh ${extra[*]}"; then
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

uninstall_roscomvpn() {
  echo "Reverting Hiddify subscription patches to stock..."
  rm -f /etc/systemd/system/hiddify-panel.service.d/roscomvpn.conf
  if [[ -d /etc/systemd/system/hiddify-panel.service.d ]] \
     && [[ -z "$(ls -A /etc/systemd/system/hiddify-panel.service.d 2>/dev/null)" ]]; then
    rmdir /etc/systemd/system/hiddify-panel.service.d || true
  fi
  systemctl daemon-reload || true

  python3 - << 'PY'
from pathlib import Path

inject = '''    resp.headers['test-url'] = "https://cp.cloudflare.com/generate_204"
    try:
        from hiddify_roscomvpn import attach_routing_headers
        attach_routing_headers(resp)
    except Exception:
        pass
'''
hook = '''    try:
        from hiddify_roscomvpn import attach_routing_headers
        attach_routing_headers(resp)
    except Exception:
        pass
'''
stock = '    resp.headers[\'test-url\'] = "https://www.gstatic.com/generate_204"\n'
root = Path("/opt/hiddify-manager")
cands = list(root.glob(".venv*/lib/python*/site-packages"))
for site in cands:
    user_py = site / "hiddifypanel/panel/user/user.py"
    if user_py.is_file():
        text = user_py.read_text(encoding="utf-8")
        text = text.replace(inject, stock)
        text = text.replace(hook, "")
        text = text.replace(
            '    resp.headers[\'test-url\'] = "https://cp.cloudflare.com/generate_204"\n',
            stock,
        )
        user_py.write_text(text, encoding="utf-8")
        print("reverted", user_py)
    sb = site / "hiddifypanel/hutils/proxy/singbox.py"
    if sb.is_file():
        t = sb.read_text(encoding="utf-8")
        t2 = t.replace("https://cp.cloudflare.com/generate_204", "https://www.gstatic.com/generate_204")
        if t2 != t:
            sb.write_text(t2, encoding="utf-8")
            print("reverted", sb)
    mod = site / "hiddify_roscomvpn.py"
    if mod.exists():
        mod.unlink()
        print("removed", mod)
    cache = site / "hiddify_roscomvpn.__pycache__"
    # leftover bytecode
    pyc = site / "__pycache__"
    if pyc.is_dir():
        for f in pyc.glob("hiddify_roscomvpn*"):
            f.unlink()
            print("removed", f)
PY

  rm -rf /opt/hiddify-custom
  systemctl restart hiddify-panel
  sleep 2
  systemctl is-active hiddify-panel
  echo
  echo "Uninstalled. Subscription headers are stock Hiddify again."
  echo "If Happ/INCY already imported RoscomVPN routing, delete that profile in the app (or toggle it off)."
}

if [[ "$UNINSTALL" == 1 ]]; then
  uninstall_roscomvpn
  exit 0
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
    "happ": [
        "https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-routing@main/HAPP/DEFAULT.DEEPLINK",
        "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/HAPP/DEFAULT.DEEPLINK",
    ],
    "incy": [
        "https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-routing@main/INCY/DEFAULT.DEEPLINK",
        "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/INCY/DEFAULT.DEEPLINK",
    ],
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
        last_err = None
        for spec in URLS[kind]:
            try:
                value = _http_get(spec).strip()
                if not value or "://" not in value:
                    raise ValueError("empty or invalid deeplink")
                st["value"] = value
                st["fetched_at"] = now
                st["last_fail"] = 0.0
                _write_disk(kind, value)
                return _optional(value)
            except Exception as exc:
                last_err = exc
                continue
        st["last_fail"] = now
        cached = st["value"] or _read_disk(kind)
        st["value"] = cached
        return _optional(cached)


def _optional(deeplink: str) -> str:
    """Use add (not onadd) so Happ/INCY do not force-lock the routing toggle."""
    if not deeplink:
        return ""
    return deeplink.replace("://routing/onadd/", "://routing/add/", 1)


def kind_for_ua(ua: str):
    if not ua:
        return None
    if re.search(r"(?i)(^|[^a-z0-9])incy([^a-z0-9]|$)", ua):
        return "incy"
    if re.search(r"(?i)(^|[^a-z0-9])happ([^a-z0-9]|$)", ua):
        return "happ"
    return None


def attach_routing_headers(resp) -> None:
    try:
        from flask import request
        ua = (request.headers.get("User-Agent") or "") if request else ""
    except Exception:
        ua = ""
    kind = kind_for_ua(ua)
    if not kind:
        return
    deeplink = get_deeplink(kind)
    if not deeplink:
        return
    resp.headers["routing"] = deeplink
PY

cat > /opt/hiddify-custom/apply-subscription-patches.py << 'PY'
#!/usr/bin/env python3
from pathlib import Path
import os
import shutil
import sys

STRICT = os.environ.get("ROSCOMVPN_STRICT", "0") == "1"


def die(msg: str) -> None:
    print("ERROR:", msg, file=sys.stderr)
    sys.exit(1 if STRICT else 0)


def find_site() -> Path:
    root = Path("/opt/hiddify-manager")
    cands = [p for p in root.glob(".venv*/lib/python*/site-packages")
             if (p / "hiddifypanel/panel/user/user.py").is_file()]
    if not cands:
        die("hiddifypanel not found")
        raise SystemExit(0)
    return sorted(cands, key=lambda p: p.stat().st_mtime)[-1]

SITE = find_site()
SRC = Path("/opt/hiddify-custom/hiddify_roscomvpn.py")
if not SRC.is_file():
    die("missing /opt/hiddify-custom/hiddify_roscomvpn.py")
    raise SystemExit(0)
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
            die("test-url line not found in user.py; Hiddify panel code changed, skip patch")
            raise SystemExit(0)

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

ROSCOMVPN_STRICT=1 python3 /opt/hiddify-custom/apply-subscription-patches.py

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
# Must not fail: a Hiddify update that changes user.py should still start the panel.
ExecStartPre=+/bin/bash -c '/usr/bin/python3 /opt/hiddify-custom/apply-subscription-patches.py || true'
EOF

systemctl daemon-reload
systemctl restart hiddify-panel
sleep 2
systemctl is-active hiddify-panel

echo
echo "Done. Cloudflare test-url + optional RoscomVPN routing (Happ/INCY) are installed."
echo "Users must refresh the subscription. Routing toggle stays user-controlled."
