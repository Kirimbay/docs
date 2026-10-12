#!/usr/bin/env python3
"""Bind Happ routing to the subscription that serves the pasted link.

Happ applies a profile to one subscription only when that subscription's
response includes the routing header. The address stored in the app stays
the original link. Other clients do not receive the header.
"""
from __future__ import annotations

import glob
import re
import shutil
import ssl
import subprocess
import time
import urllib.request
from pathlib import Path

RULE_FILE = Path("/opt/kirvpn/happ-routing.txt")
BLOCK = """    # KIRVPN_ROUTING_BEGIN
    try:
        _ua = request.headers.get("User-Agent") or ""
    except Exception:
        _ua = ""
    if "happ" in _ua.lower():
        try:
            with open("/opt/kirvpn/happ-routing.txt", "r", encoding="utf-8") as _rf:
                _route = (_rf.read() or "").strip()
        except Exception:
            _route = ""
        if (
            _route.startswith("happ://routing/onadd/")
            and "\\n" not in _route
            and "\\r" not in _route
        ):
            resp.headers["routing"] = _route
    # KIRVPN_ROUTING_END
"""
ANCHOR = "    # KIRVPN_ANNOUNCE_END\n"
NEEDLE = (
    "    resp.headers['Subscription-Userinfo'] = "
    "f\"upload=0;download={c['usage_current_b']};total={c['usage_limit_b']};expire={c['expire_s']}\"\n"
)


def rule_text() -> str:
    link = RULE_FILE.read_text(encoding="utf-8").strip()
    if not link.startswith("happ://routing/onadd/") or any(ch in link for ch in "\r\n"):
        raise SystemExit("routing file is not usable")
    if len(link) < 40 or len(link) > 20000:
        raise SystemExit("routing file is not usable")
    return link


def user_py_paths() -> list[Path]:
    found = [
        Path(p)
        for p in glob.glob(
            "/opt/hiddify-manager/.venv*/lib/python3.*/site-packages/hiddifypanel/panel/user/user.py"
        )
    ]
    if not found:
        raise SystemExit("missing")
    return found


def apply_block(text: str) -> str:
    pattern = r"    # KIRVPN_ROUTING_BEGIN\n.*?    # KIRVPN_ROUTING_END\n"
    if "KIRVPN_ROUTING_BEGIN" in text:
        updated, count = re.subn(pattern, BLOCK, text, count=1, flags=re.S)
        if count != 1:
            raise SystemExit("routing block did not match")
        return updated
    if ANCHOR in text:
        return text.replace(ANCHOR, ANCHOR + BLOCK, 1)
    if NEEDLE in text:
        return text.replace(NEEDLE, NEEDLE + BLOCK, 1)
    raise SystemExit("header function not found")


def patch_files() -> list[tuple[Path, Path]]:
    backups = []
    for path in user_py_paths():
        original = path.read_text(encoding="utf-8")
        updated = apply_block(original)
        if "KIRVPN_ROUTING_BEGIN" not in updated or updated.count("KIRVPN_ROUTING_BEGIN") != 1:
            raise SystemExit("routing block missing after patch")
        backup = path.with_name("user.py.bak-before-happ-routing")
        if not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(updated, encoding="utf-8")
        subprocess.check_call(["python3", "-m", "py_compile", str(path)])
        backups.append((path, backup))
    return backups


def restore(backups: list[tuple[Path, Path]]) -> None:
    for path, backup in backups:
        if backup.exists():
            shutil.copy2(backup, path)


def mysql(sql: str) -> str:
    try:
        return subprocess.check_output(
            ["mysql", "-N", "--default-character-set=utf8mb4", "-e", sql], text=True
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit("mysql") from exc


def verify(link: str) -> None:
    rows = [ln.split("\t") for ln in mysql("SELECT domain,mode FROM hiddifypanel.domain").splitlines() if ln.strip()]
    host = next((d for d, mode in rows if d.endswith(".sarafan.uk") and mode == "direct" and not d.startswith("bs1.")), "")
    if not host:
        host = next((d for d, _mode in rows if d.endswith(".sarafan.uk") and not d.startswith("bs1.")), "")
    if not host:
        raise SystemExit("no subscription host")
    path = mysql("SELECT value FROM hiddifypanel.str_config WHERE `key`='proxy_path'").strip()
    user = mysql("SELECT uuid FROM hiddifypanel.user WHERE name='default' LIMIT 1").strip()
    if not user:
        user = mysql("SELECT uuid FROM hiddifypanel.user LIMIT 1").strip()
    if not path or not user:
        raise SystemExit("no subscription")
    url = "https://127.0.0.1/%s/%s/" % (path, user)
    ctx = ssl._create_unverified_context()

    def fetch(ua: str):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Host": host})
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            body = resp.read()
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, headers, body

    status, headers, body = fetch("Happ/1.51.0")
    routing = headers.get("routing") or ""
    other_status, other_headers, _other_body = fetch("Mozilla/5.0")
    sample = body[:1200].lstrip().lower()
    if status != 200 or other_status != 200 or not body:
        raise SystemExit("subscription request failed")
    if sample.startswith(b"<") or sample.startswith(b"<!doctype"):
        raise SystemExit("subscription returned html")
    if routing != link:
        raise SystemExit("happ routing header mismatch")
    if other_headers.get("routing"):
        raise SystemExit("routing leaked to another client")
    print("verify-ok", status, len(routing), other_headers.get("routing") is None)


def main() -> None:
    link = rule_text()
    backups = patch_files()
    subprocess.call(["systemctl", "restart", "hiddify-panel"])
    last = "not-checked"
    for _ in range(12):
        time.sleep(2)
        try:
            verify(link)
            return
        except SystemExit as exc:
            last = str(exc.code or "verify")
        except Exception as exc:
            last = exc.__class__.__name__
    restore(backups)
    subprocess.call(["systemctl", "restart", "hiddify-panel"])
    raise SystemExit("rolled-back " + last)


if __name__ == "__main__":
    main()
