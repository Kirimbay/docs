# Тигр (RO): фронт + exit через WireGuard DNAT

Схема для **🇷🇴🐅 Тигр** без нарезки (`finalMask = null`).

Фронт и exit у разных хостеров → общей LAN нет. Между ними **WireGuard**,
на фронте прозрачный **iptables DNAT** (как у Слона), без HAProxy.

```
телефон
  → 103.102.229.156:443     (фронт RO, Hostox)
  → iptables DNAT
  → 10.77.14.2:443          (exit SE 014 по WG)
  → Xray Reality 14_TIGR    (SNI bulkio.org, dest 127.0.0.1:8446 Bulkio-заглушка)
```

Публичный `:443` на exit закрыт (только `wg-tiger` / `lo`).

| Роль | Хост | Публичный IP | WG |
|------|------|--------------|-----|
| Фронт | ZaNet-533 | `103.102.229.156` | `10.77.14.1/24` |
| Exit | `14-rel` (🇸🇪 014) | `136.148.223.243` | `10.77.14.2/24`, UDP `51814` |

## Что уже сделано (2026-11-15)

1. На фронте снесён Hiddify/tmpl (бэкап `/root/front-wipe-backup-*`).
2. WG `wg-tiger` + `tiger-dnat.service` на фронте.
3. На exit: Bulkio-заглушка `/var/www/bulkio-decoy`, nginx `127.0.0.1:8446`,
   `tiger-exit-fw.service`, remnanode с `14_TIGR` (serverNames `bulkio.org`).
4. В панели: хост `🇷🇴🐅 Тигр` → `103.102.229.156:443`, SNI `bulkio.org`,
   без нарезки; нода 014 включена.

## DNS

Пока в подписке **address = IP фронта**. Когда будет удобно — A-запись
`bulkio.org` → `103.102.229.156`, затем в панели address можно сменить на
`bulkio.org`.

## Проверка

```bash
# WG
ping -c1 10.77.14.2          # с фронта

# Reality dest через фронт (должен отдать CN=bulkio.org)
openssl s_client -connect 103.102.229.156:443 -servername bulkio.org </dev/null

# публичный exit :443 должен НЕ отвечать
openssl s_client -connect 136.148.223.243:443 -servername bulkio.org </dev/null

# подписка: 🇷🇴🐅 Тигр, security=reality, без fm=
```

## Откат фронта

```bash
systemctl disable --now tiger-dnat.service
# снять DNAT-правила вручную или перезагрузка без unit
```
