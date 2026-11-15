# Краб (front → SE 037): WireGuard **over IPv6** + Reality stub on front

Subscription host: **🇸🇪🦀 Краб** (`144.31.13.79`, SNI `x37.kirz.co.uk`).

```
client → 144.31.13.79:443 (front)
      → iptables DNAT
      → 10.77.37.2:443 (exit SE 037 via WG)
      → Xray Reality 37_KRAB (dest 10.77.37.1:8446)
      → nginx stub on front (x37.kirz.co.uk)
```

| Role | Host | IPv4 | IPv6 | WG |
|------|------|------|------|-----|
| Front | vps-26530 | `144.31.13.79` | `2a12:bec4:1ac0:116d::1` | `10.77.37.1/24`, UDP `51837` |
| Exit | `37-rel` (🇸🇪 037) | `185.113.11.189` | `2a13:7c82:116:7a::` | `10.77.37.2/24`, UDP `51837` |

## Stability (IPv6 path)

- WG **Endpoint** uses IPv6 only (`[addr]:51837`) both ways.
- Fixed ListenPort `51837`, `PersistentKeepalive=15`, `MTU=1280`, TCPMSS clamp (v4+v6).
- `krab-wg-watchdog.timer` every 20s on both hosts (auto role by `10.77.37.1`/`.2`).
- Exit: WG UDP accepted only from front IPv6; remnanode `:2222` only from panel; public 80/443/… dropped; nginx stopped.

## Panel

- Inbound `37_KRAB` Reality listen `10.77.37.2`, target `10.77.37.1:8446`.
- Host `🇸🇪🦀 Краб` → front IPv4, SNI `x37.kirz.co.uk`.
- Other `37_*` inbounds bound to `127.0.0.1`.
