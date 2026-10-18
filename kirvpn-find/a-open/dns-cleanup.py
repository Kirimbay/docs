#!/usr/bin/env python3
"""Certbot DNS-01 cleanup. Removes the TXT record created for one name."""

import json
import os
import urllib.request
from pathlib import Path

ZONES = {
    "kirvpn.ru": "ee3e566259a309a471fb5f08c1f1de53",
    "kirvpn.us": "3f862e2dd8e45f25edcd3a32ebd34185",
    "sarafan.uk": "6ff05330e071d50f1de75e9429a102d9",
}


def token() -> str:
    for line in Path("/root/.config/a-open/cf.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("CF_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def zone_for(domain: str) -> str:
    for name, zone_id in ZONES.items():
        if domain == name or domain.endswith("." + name):
            return zone_id
    raise SystemExit("no zone for " + domain)


def main() -> None:
    secret = token()
    if not secret:
        return
    domain = os.environ.get("CERTBOT_DOMAIN", "")
    if not domain:
        return
    zone_id = zone_for(domain)
    name = "_acme-challenge." + domain
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
    req = urllib.request.Request(
        f"{base}?type=TXT&name={name}",
        headers={"Authorization": "Bearer " + secret},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.load(res)
    for rec in payload.get("result") or []:
        drop = urllib.request.Request(
            f"{base}/{rec['id']}",
            method="DELETE",
            headers={"Authorization": "Bearer " + secret},
        )
        urllib.request.urlopen(drop, timeout=30).read()
    id_file = Path("/var/lib/a-open/acme") / (domain + ".id")
    if id_file.exists():
        id_file.unlink()


if __name__ == "__main__":
    main()
