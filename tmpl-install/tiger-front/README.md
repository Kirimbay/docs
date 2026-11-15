# Тигр (PL front → SE exit): WireGuard DNAT + Reality stub на фронте

Схема для **🇸🇪🐅 Тигр** без нарезки (`finalMask = null`).

Фронт (Польша) и exit (Швеция 014) у разных хостеров → общей LAN нет.
Между ними **WireGuard**, на фронте прозрачный **iptables DNAT** (как у Слона),
без HAProxy. Bulkio-заглушка живёт на **фронте**, не на exit.

```
телефон
  → 48.103.140.6:443        (фронт PL, ZaNet-911)
  → iptables DNAT
  → 10.77.14.2:443          (exit SE 014 по WG, только wg-tiger)
  → Xray Reality 14_TIGR    (SNI bulkio.org, dest 10.77.14.1:8446)
  → nginx Bulkio-stub на фронте (10.77.14.1:8446 / 127.0.0.1:8446)
```

Публичный `:443` / `:80` / `:8443` / `:8446` на exit закрыты на eth0/eth1
(`tiger-exit-fw.service`, raw PREROUTING DROP). Xray слушает только
`10.77.14.2:443` (WG).

| Роль | Хост | Публичный IP | WG |
|------|------|--------------|-----|
| Фронт | ZaNet-911 (PL) | `48.103.140.6` | `10.77.14.1/24` |
| Exit | `14-rel` (🇸🇪 014) | `136.148.223.243` | `10.77.14.2/24`, UDP `51814` |

Старый RO-фронт `103.102.229.156` больше не используется.

## Что сделано (2026-11-15)

1. WG `wg-tiger` (ключи ротированы): exit `10.77.14.2`, front `10.77.14.1`, UDP `51814`.
2. На фронте: `tiger-dnat.service` (`48.103.140.6:443` → `10.77.14.2:443`),
   nginx Bulkio-stub на `10.77.14.1:8446` + `127.0.0.1:8446` + HTTP `:80`,
   cert CN=`bulkio.org`.
3. На exit: локальный Reality-dest/stub снят; `tiger-exit-fw.service`;
   remnanode `14_TIGR` → `listen 10.77.14.2`, `target 10.77.14.1:8446`,
   `serverNames bulkio.org` / `www.bulkio.org`.
4. В панели: хост `🇸🇪🐅 Тигр` → `48.103.140.6:443`, SNI `bulkio.org`,
   без нарезки; нода 🇸🇪 014.

## DNS

Пока в подписке **address = IP фронта** (`48.103.140.6`). Когда будет удобно —
A-запись `bulkio.org` → `48.103.140.6`, затем в панели address можно сменить на
`bulkio.org`.

## Проверка

```bash
# WG
ping -c1 10.77.14.2          # с фронта
curl -skI https://10.77.14.1:8446/ -H 'Host: bulkio.org'   # с exit

# Reality fallback через фронт (CN=bulkio.org)
openssl s_client -connect 48.103.140.6:443 -servername bulkio.org </dev/null

# публичный exit :443 должен НЕ отвечать
openssl s_client -connect 136.148.223.243:443 -servername bulkio.org </dev/null

# подписка: 🇸🇪🐅 Тигр @ 48.103.140.6, security=reality, без fm=
```

## Откат фронта

```bash
systemctl disable --now tiger-dnat.service
# или: FRONT_IP=48.103.140.6 /usr/local/sbin/tiger-dnat.sh --rollback
```
