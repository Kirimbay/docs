# Kirz patches (2026-10-28)

- `hap-ins.py` / `sub.py`: do **not** route `admin_path` to tmpl-sub (fixes admin login hijack)
- tmpl-sub HAProxy backend: `retries 2`, `timeout server 8s` (stops endless sub spinner)
- `hook.sh` / `acme-copy.sh` / `install.sh`: publish domain cert into `/opt/hiddify-manager/ssl/` (SNI)
- `relay.sh`: REJECT UDP/443 with ICMP port-unreachable (Happ HTTP/3 → fast TCP fallback on mobile)
- `fix-all.sh`: idempotent repair for already-installed servers (exit + `--relay --exit IP`)

Full install package (with binaries): `https://ro1.kirz.co.uk:8090/get.sh`
