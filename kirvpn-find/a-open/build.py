#!/usr/bin/env python3
"""Build the static chooser page and the nginx site file from map.json."""

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAP = json.loads((ROOT / "map.json").read_text(encoding="utf-8"))
NOTE = (
    "Справа от своего имени три точки → «Маршрутизация» → еще раз три точки вверху "
    "→ «Копировать из» → RoscomVPN. Выключи VPN и включи снова."
)


def data_uri(name: str) -> str:
    raw = (ROOT / f"{name}.jpg").read_bytes()
    if not raw.startswith(b"\xff\xd8\xff"):
        raise SystemExit(f"{name}.jpg is not a jpeg")
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")


def page() -> str:
    mapping = json.dumps(MAP, ensure_ascii=False, separators=(",", ":"))
    happ = data_uri("happ")
    incy = data_uri("incy")
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0b1220">
  <title>Ключ</title>
  <meta name="description" content="Ключ">
  <meta property="og:title" content="Ключ">
  <meta property="og:description" content="Ключ">
  <meta property="og:site_name" content="Ключ">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Ключ">
  <meta name="twitter:description" content="Ключ">
  <style>
    body{{margin:0;background:#0b1220;color:#e8eefc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif}}
    main{{max-width:440px;margin:0 auto;padding:16px 14px 18px}}
    h1,h2{{margin:0 0 8px;font-size:1.05rem;font-weight:700;text-align:center}}
    h2{{margin-top:16px}}.note{{margin:0;color:#9bb0d0;font-size:0.68rem;line-height:1.25;text-align:left;font-weight:400}}
    .apps{{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}}.slot{{display:flex;flex-direction:column;gap:6px;min-width:0}}
    a.pick{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:108px;padding:10px 8px;border-radius:14px;border:1px solid #24324d;background:#121b2e;color:#fff;text-decoration:none;font-weight:700;font-size:0.95rem}}
    a.pick img{{width:56px;height:56px;border-radius:14px;display:block}}
    a.info{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;margin:14px 0 0;min-height:52px;padding:10px 12px;border-radius:14px;border:1px solid #24324d;background:#121b2e;color:#fff;text-decoration:none;font-weight:700;font-size:1rem}}
    a.info span{{color:#9bb0d0;font-size:0.75rem;font-weight:500}}
  </style>
</head>
<body><main><h1>Ключ для</h1><div class="apps">
<a class="pick" data-app href="happ://add/"><img alt="" src="{happ}"><span>Happ</span></a>
<a class="pick" data-app href="incy://import/"><img alt="" src="{incy}"><span>Incy</span></a>
</div>
<script>(function(){{var MAP={mapping};var orig=MAP[(location.hostname||"").toLowerCase()];if(!orig)return;var url="https://"+orig+location.pathname+location.search;var n=document.querySelectorAll("a[data-app]");if(n[0])n[0].href="happ://add/"+url+location.hash;if(n[1])n[1].href="incy://import/"+url+location.hash;}})();</script>
<!--#include virtual="/rules-snippet.html" -->
<a class="info" href="https://info.sarafan.uk/">Информация<span>info.sarafan.uk</span></a>
</main></body></html>
"""


def nginx() -> str:
    names = " ".join(sorted(MAP))
    return f"""# Chooser for the letter-A names. Keep these DNS records grey-cloud,
# pointed at this server. Proxied records go through Cloudflare.
server {{
    listen 80;
    listen [::]:80;
    server_name {names};
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location / {{ return 301 https://$host$request_uri; }}
}}
server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {names};

    ssl_certificate     /etc/letsencrypt/live/a-open/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/a-open/privkey.pem;

    root /var/www/a-open;
    charset utf-8;
    access_log /var/log/nginx/a-open.log aopen;

    add_header Cache-Control "no-store" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header X-Content-Type-Options "nosniff" always;

    location = /rules-snippet.html {{
        internal;
        ssi off;
        default_type text/html;
        root /var/www/a-open;
    }}

    location / {{
        ssi on;
        ssi_silent_errors on;
        default_type text/html;
        try_files /index.html =404;
    }}
}}
"""


def main() -> None:
    html = page()
    if "KirVPN" in html or "kirvpn" in html.split("var MAP=")[0]:
        raise SystemExit("brand leaked into the page head")
    if html.count("data-app href") != 2:
        raise SystemExit("expected two subscription buttons")
    if MAP["ahid8.kirvpn.us"] != "hid8.kirvpn.us":
        raise SystemExit("hid8.us mapping changed")
    if MAP["a14.kirvpn.us"] != "14.kirvpn.ru":
        raise SystemExit("us copy must keep the ru subscription")
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    (ROOT / "a-open.nginx.conf").write_text(nginx(), encoding="utf-8")
    print(f"names {len(MAP)} html {len(html)}")


if __name__ == "__main__":
    main()
