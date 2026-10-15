#!/usr/bin/env python3
"""Refresh the rules buttons and the geo files they point at.

A failed refresh keeps the previous buttons. The key buttons do not use this.
"""

import base64
import os
import re
import tempfile
import urllib.request
from pathlib import Path

STATE = Path("/var/lib/a-open")
SNIPPET = Path("/var/www/a-open/rules-snippet.html")
GEO_DIR = Path("/var/www/info.sarafan.uk/geo")
GEOIP_URL = "https://info.sarafan.uk/geo/geoip.dat"
GEOSITE_URL = "https://info.sarafan.uk/geo/geosite.dat"
SOURCES = {
    "happ": "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/HAPP/DEFAULT.JSON",
    "incy": "https://raw.githubusercontent.com/hydraponique/roscomvpn-routing/main/INCY/DEFAULT.JSON",
}
SCHEMES = {"happ": "happ://routing/onadd/", "incy": "incy://routing/onadd/"}
NOTE = (
    "Справа от своего имени три точки → «Маршрутизация» → еще раз три точки вверху "
    "→ «Копировать из» → RoscomVPN. Выключи VPN и включи снова."
)
GEO_RE = {
    "geoip": re.compile(r"https://cdn\.jsdelivr\.net/gh/hydraponique/roscomvpn-geoip[^\"\\\s]*"),
    "geosite": re.compile(r"https://cdn\.jsdelivr\.net/gh/hydraponique/roscomvpn-geosite[^\"\\\s]*"),
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "a-open"})
    with urllib.request.urlopen(req, timeout=20) as res:
        if res.status != 200:
            raise RuntimeError(f"{res.status} {url}")
        return res.read()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o755)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def link_for(app: str, text: str) -> str:
    found = {}
    for kind, pattern in GEO_RE.items():
        match = pattern.search(text)
        if not match:
            raise RuntimeError(f"no {kind} url in {app}")
        found[kind] = match.group(0)
    for kind, url in found.items():
        atomic_write(GEO_DIR / f"{kind}.dat", fetch(url))
    rewritten = GEO_RE["geoip"].sub(GEOIP_URL, text)
    rewritten = GEO_RE["geosite"].sub(GEOSITE_URL, rewritten)
    encoded = base64.b64encode(rewritten.encode("utf-8")).decode("ascii")
    return SCHEMES[app] + encoded


def button(href: str, icon: str, label: str) -> str:
    return (
        f'<a class="pick" href="{href}"><img alt="" src="{icon}">'
        f"<span>{label}</span></a>"
    )


def icon(name: str) -> str:
    raw = (Path("/opt/a-open") / f"{name}.jpg").read_bytes()
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")


def snippet(happ: str, incy: str) -> str:
    icons = {"happ": icon("happ"), "incy": icon("incy")}
    return (
        "<h2>Правила для</h2><div class=\"apps\">"
        "<div class=\"slot\">"
        + button(happ, icons["happ"], "Happ")
        + f'<p class="note">{NOTE}</p></div>'
        + button(incy, icons["incy"], "Incy")
        + "</div>\n"
    )


def main() -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    links = {}
    for app, url in SOURCES.items():
        links[app] = link_for(app, fetch(url).decode("utf-8"))
        atomic_write(STATE / f"{app}.link", (links[app] + "\n").encode("utf-8"))
    atomic_write(SNIPPET, snippet(links["happ"], links["incy"]).encode("utf-8"))
    print("rules refreshed", len(links["happ"]), len(links["incy"]))


if __name__ == "__main__":
    main()
