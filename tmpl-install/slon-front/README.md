# Слон (front 105 → exit 058): локальный WG + Reality stub на фронте

Subscription host: **🇸🇪🐘 Слон** → address/SNI **`bytera.cc`**.

Фронт `136.148.213.105` и exit `136.148.223.200` (🇸🇪 058) без общей HostUp LAN →
WG поверх публичного IPv4 (~0.5 ms), прозрачный iptables DNAT (без TLS-inspect).

```
client → bytera.cc:443 → 136.148.213.105 (front)
      → iptables DNAT
      → 10.77.58.2:443 (exit 058 via wg-slon)
      → Xray Reality 58_SLON_X20 (dest 10.77.58.1:8446)
      → nginx Bytera stub on front :8446
```

| Role | Host | IPv4 | WG |
|------|------|------|-----|
| Front | `105` | `136.148.213.105` | `10.77.58.1/24`, UDP `51858` |
| Exit | `58-rel` (🇸🇪 058) | `136.148.223.200` | `10.77.58.2/24`, UDP `51858` |

## Stub / DNS

- Decoy: **Bytera** на фронте `10.77.58.1:8446` / `127.0.0.1:8446` (LE cert).
- DNS: `bytera.cc` + `www` **A → `136.148.213.105`** (DNS-only).
- finalMask (fragment tlshello) на хосте **сохраняется**.

## Stability

- Fixed ListenPort `51858` both sides + mutual `Endpoint` + `PersistentKeepalive=15`.
- `MTU=1280` + TCPMSS clamp on DNAT/WG path.
- `slon-wg-watchdog.timer` every 20s on **both** hosts (role by `10.77.58.1`/`.2`); recovers DNAT/lockdown only if critical rules are missing (no delete/reinsert flaps).
- Boot persistence via oneshot units (`slon-dnat.service` / `slon-exit-fw.service`).
- Exit lockdown: public 80/443/… DROP by dest IP + known NIC names; remnanode `:2222` panel IPv4 only; IPv6 `:2222` DROP.
- Legacy HostUp DNAT to `10.202.120.54` is removed by `slon-dnat.sh apply`.

### Front install

```bash
install -m 0755 slon-dnat.sh /usr/local/sbin/slon-dnat.sh
install -m 0755 slon-wg-watchdog.sh /usr/local/sbin/slon-wg-watchdog.sh
install -m 0644 slon-dnat.service /etc/systemd/system/slon-dnat.service
install -m 0644 slon-wg-watchdog.service /etc/systemd/system/slon-wg-watchdog.service
install -m 0644 slon-wg-watchdog.timer   /etc/systemd/system/slon-wg-watchdog.timer
systemctl daemon-reload
systemctl enable --now wg-quick@wg-slon.service slon-dnat.service slon-wg-watchdog.timer
systemctl disable --now slon-dnat.service 2>/dev/null || true  # if old HostUp unit name conflicts — re-enable after overwrite
```

### Exit install

```bash
install -m 0755 slon-exit-fw.sh /usr/local/sbin/slon-exit-fw.sh
install -m 0755 slon-wg-watchdog.sh /usr/local/sbin/slon-wg-watchdog.sh
install -m 0644 slon-exit-fw.service /etc/systemd/system/slon-exit-fw.service
install -m 0644 slon-wg-watchdog.service /etc/systemd/system/slon-wg-watchdog.service
install -m 0644 slon-wg-watchdog.timer   /etc/systemd/system/slon-wg-watchdog.timer
systemctl daemon-reload
systemctl enable --now wg-quick@wg-slon.service slon-exit-fw.service slon-wg-watchdog.timer
```

## Panel

- Inbound `58_SLON_X20` Reality listen `10.77.58.2`, target `10.77.58.1:8446`, serverNames `bytera.cc` / `www.bytera.cc` (same Reality keys as former `54_SLON_X20`).
- `58_TIGR` listen moved to `127.0.0.1` (frees `:443` bind conflict).
- Host `🇸🇪🐘 Слон` → `bytera.cc`, node 🇸🇪 058, inbound `58_SLON_X20`.
