# Краб (front → SE 037): WireGuard **over IPv6** + Reality stub on front

Subscription host: **🇸🇪🦀 Краб** → address/SNI **`datatransfer.cc`** (never bare IP / `x*.kirz.co.uk`).

```
client → datatransfer.cc:443 → 144.31.13.79 (front)
      → iptables DNAT
      → 10.77.37.2:443 (exit SE 037 via WG)
      → Xray Reality 37_KRAB (dest 10.77.37.1:8446)
      → nginx Datatransfer stub on front :8446
```

| Role | Host | IPv4 | IPv6 | WG |
|------|------|------|------|-----|
| Front | vps-26530 | `144.31.13.79` | `2a12:bec4:1ac0:116d::1` | `10.77.37.1/24`, UDP `51837` |
| Exit | `37-rel` (🇸🇪 037) | `185.113.11.189` | `2a13:7c82:116:7a::` | `10.77.37.2/24`, UDP `51837` |

## Stub / DNS

- Decoy site: **Datatransfer** (mirror of infra stub from `36.kirvpn.ru`, rebranded) on front `10.77.37.1:8446`.
- DNS: `datatransfer.cc` + `www` **A → `144.31.13.79`**, then issue LE cert for Reality dest.
- Until DNS moves, front may use a temporary self-signed `CN=datatransfer.cc`.

## Stability (IPv6 path)

- WG **Endpoint** uses IPv6 only (`[addr]:51837`) both ways.
- Fixed ListenPort `51837`, `PersistentKeepalive=15`, `MTU=1280`, TCPMSS clamp (v4+v6).
- Exit: WG UDP accepted only from front IPv6; remnanode `:2222` only from panel **IPv4** (IPv6 `:2222` dropped); public 80/443/… dropped; nginx stopped.

### Watchdog install (both hosts)

```bash
install -m 0755 krab-wg-watchdog.sh /usr/local/sbin/krab-wg-watchdog.sh
install -m 0644 krab-wg-watchdog.service /etc/systemd/system/krab-wg-watchdog.service
install -m 0644 krab-wg-watchdog.timer   /etc/systemd/system/krab-wg-watchdog.timer
systemctl daemon-reload
systemctl enable --now krab-wg-watchdog.timer
```

Timer every 20s; script auto-detects role by WG address (`10.77.37.1` = front, `.2` = exit).

## Panel

- Inbound `37_KRAB` Reality listen `10.77.37.2`, target `10.77.37.1:8446`, serverNames `datatransfer.cc` / `www.datatransfer.cc`.
- Host `🇸🇪🦀 Краб` → `datatransfer.cc`, SNI `datatransfer.cc`.
- Other `37_*` inbounds bound to `127.0.0.1`.
