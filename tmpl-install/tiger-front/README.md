# Тигр (PL front → SE exit 036): WireGuard DNAT + Reality stub на фронте

Схема для **🇸🇪🐅 Тигр** (`bulkio.org`), без нарезки (`finalMask = null`).

Фронт (Польша) и exit (Швеция 036) у разных хостеров → общей LAN нет.
Между ними **WireGuard**, на фронте прозрачный **iptables DNAT**.
Bulkio-заглушка живёт на **фронте**.

```
телефон
  → bulkio.org / 48.103.140.6:443   (фронт PL)
  → iptables DNAT
  → 10.77.14.2:443                  (exit SE 036 по WG, только wg-tiger)
  → Xray Reality 36_TIGR            (SNI bulkio.org, dest 10.77.14.1:8446)
  → nginx Bulkio-stub на фронте     (10.77.14.1:8446 / 127.0.0.1:8446)
```

## Хосты

| Роль | Хост | Публичный IP | WG |
|------|------|--------------|-----|
| Фронт | ZaNet-911 (PL) | `48.103.140.6` | `10.77.14.1/24`, UDP `51814` |
| Exit | `36-rel` (🇸🇪 036) | `136.148.220.250` | `10.77.14.2/24`, UDP `51814` |

Старый exit `136.148.223.243` (🇸🇪 014) для Тигра отключён в панели.

## Железобетонный WG (урок с обрывами)

Прошлый мост рвался: у фронта был **динамический** ListenPort, endpoint
только с одной стороны, watchdog не было, `tiger-exit-fw` не был enabled.

Сейчас:

1. **Фиксированный UDP `51814` с обеих сторон** + `Endpoint` друг на друга.
2. `PersistentKeepalive = 15` на front и exit.
3. `MTU = 1280` + TCPMSS clamp на DNAT/WG path.
4. `tiger-wg-watchdog.timer` (каждые 20 с) на **обоих** хостах
   (`tiger-wg-watchdog.sh` сам определяет роль по адресу WG:
   `10.77.14.1` = front, `10.77.14.2` = exit; при необходимости `ROLE=front|exit`):
   - пере-пинит endpoint своего peer;
   - при handshake старше 120 с — ping-poke;
   - старше 180 с — soft `wg-quick` bounce + re-apply fw/dnat.
5. WG UDP на exit принимается **только** с `48.103.140.6`.

## Lockdown exit

Публичный exit не должен светиться сервисами:

- Xray Reality слушает **только** `10.77.14.2:443` (WG).
- `tiger-exit-fw.service`: raw+filter DROP на eth0 для
  `80/443/8443/8446/47136/49740/...`.
- remnanode `:2222` — только с панели `136.148.212.221`.
- SSH `:22` оставлен для админки.
- nginx на exit **остановлен** (заглушка на фронте).

## Панель

- Хост `🇸🇪🐅 Тигр` → inbound `36_TIGR`, address/SNI `bulkio.org`, нода 🇸🇪 036.
- Reality keys/shortId как у бывшего `14_TIGR` (тот же `pbk` для клиентов).
- Нода 🇸🇪 014: `is_disabled = true`.

## Проверка

```bash
# WG
ping -c3 10.77.14.2          # с фронта
ping -c3 10.77.14.1          # с exit
curl -skI https://10.77.14.1:8446/ -H 'Host: bulkio.org'   # с exit

# Reality fallback через фронт (CN=bulkio.org)
openssl s_client -connect 48.103.140.6:443 -servername bulkio.org </dev/null

# публичный exit :443 / :80 не должен отдавать сервис
openssl s_client -connect 136.148.220.250:443 -servername bulkio.org </dev/null

# watchdog
systemctl list-timers 'tiger-wg-watchdog*'
journalctl -u tiger-wg-watchdog.service -n 20 --no-pager
```

## Откат фронта

```bash
systemctl disable --now tiger-dnat.service tiger-wg-watchdog.timer
FRONT_IP=48.103.140.6 EXIT_WG=10.77.14.2 /usr/local/sbin/tiger-dnat.sh --rollback
```
