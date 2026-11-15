# Утка (front 051 → exit 057): локальный WG + Reality stub на фронте

Subscription host: **🇸🇪🦆 Утка** → address/SNI **`dataz.cc`** (забрано у отключённого 🇵🇱🦅 Орла).

Фронт и exit в одной LAN HostUp (`185.113.11.0/24`, ~1 ms) → WG поверх IPv4,
прозрачный iptables DNAT (как у Слона/Тигра: без TLS-inspect, пакеты не пересобираются).

```
client → dataz.cc:443 → 185.113.11.52 (front 051)
      → iptables DNAT
      → 10.77.57.2:443 (exit 057 via wg-utka)
      → Xray Reality 57_UTKA (dest 10.77.57.1:8446)
      → nginx Dataz stub on front :8446
```

| Role | Host | IPv4 | WG |
|------|------|------|-----|
| Front | `51-rel` | `185.113.11.52` | `10.77.57.1/24`, UDP `51857` |
| Exit | `57-rel` (🇸🇪 057) | `185.113.11.79` | `10.77.57.2/24`, UDP `51857` |

## Stub / DNS

- Decoy: **Dataz** (с бывшего Орла) на фронте `10.77.57.1:8446` / `127.0.0.1:8446`.
- DNS: `dataz.cc` + `www` **A → `185.113.11.52`** (DNS-only), LE cert for Reality dest.
- 🇵🇱🦅 Орёл host `is_disabled=true` (домен отдан Утке).

## Stability

- Fixed ListenPort `51857` both sides + mutual `Endpoint` + `PersistentKeepalive=15`.
- `MTU=1280` + TCPMSS clamp on DNAT/WG path.
- `utka-wg-watchdog.timer` every 20s on **both** hosts (role by `10.77.57.1`/`.2`).
- Exit lockdown: public 80/443/… DROP; remnanode `:2222` panel IPv4 only; IPv6 `:2222` DROP; nginx masked.

### Watchdog install (both hosts)

```bash
install -m 0755 utka-wg-watchdog.sh /usr/local/sbin/utka-wg-watchdog.sh
install -m 0644 utka-wg-watchdog.service /etc/systemd/system/utka-wg-watchdog.service
install -m 0644 utka-wg-watchdog.timer   /etc/systemd/system/utka-wg-watchdog.timer
systemctl daemon-reload
systemctl enable --now utka-wg-watchdog.timer
```

## Panel

- Inbound `57_UTKA` Reality listen `10.77.57.2`, target `10.77.57.1:8446`, serverNames `dataz.cc` / `www.dataz.cc`.
- Other `57_*` listen `127.0.0.1`.
- Host `🇸🇪🦆 Утка` → `dataz.cc`, node 🇸🇪 057.
