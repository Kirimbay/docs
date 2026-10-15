#!/usr/bin/env python3
"""Certbot DNS-01 hook. Creates one TXT record and waits until it is visible."""

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ZONES = {
    "kirvpn.ru": "ee3e566259a309a471fb5f08c1f1de53",
    "kirvpn.us": "3f862e2dd8e45f25edcd3a32ebd34185",
    "sarafan.uk": "6ff05330e071d50f1de75e9429a102d9",
}
STATE = Path("/var/lib/a-open/acme")


def token() -> str:
    for line in Path("/root/.config/a-open/cf.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("CF_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("missing token")


def api(method: str, url: str, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.load(res)
    if not payload.get("success"):
        raise SystemExit(f"cloudflare {method} failed")
    return payload


def zone_for(domain: str) -> str:
    for name, zone_id in ZONES.items():
        if domain == name or domain.endswith("." + name):
            return zone_id
    raise SystemExit("no zone for " + domain)


def main() -> None:
    domain = os.environ["CERTBOT_DOMAIN"]
    validation = os.environ["CERTBOT_VALIDATION"]
    name = "_acme-challenge." + domain
    zone_id = zone_for(domain)
    base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
    existing = api("GET", f"{base}?type=TXT&name={name}")
    for rec in existing.get("result") or []:
        api("DELETE", f"{base}/{rec['id']}")
    created = api("POST", base, {"type": "TXT", "name": name, "content": validation, "ttl": 60})
    STATE.mkdir(parents=True, exist_ok=True)
    (STATE / (domain + ".id")).write_text(created["result"]["id"], encoding="utf-8")
    query = "https://cloudflare-dns.com/dns-query?name=" + urllib.parse.quote(name) + "&type=TXT"
    for _ in range(40):
        req = urllib.request.Request(query, headers={"Accept": "application/dns-json"})
        with urllib.request.urlopen(req, timeout=15) as res:
            answer = res.read().decode("utf-8", "replace")
        if validation in answer:
            return
        time.sleep(3)
    raise SystemExit("TXT did not publish for " + domain)


if __name__ == "__main__":
    main()
