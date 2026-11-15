# Слон: прозрачный проброс без потери нарезки

Схема для хоста **🐘 Слон** (`bytera.cc`, Reality + `finalMask` / нарезка ClientHello).

## Почему не HAProxy

HAProxy `mode tcp` сам завершает TCP с телефоном и открывает **второе** TCP к ноде.
Сегменты нарезки склеиваются/перепаковываются, тайминги меняются — DPI видит посредника,
а при SNI-inspect нарезка вообще ломает маршрутизацию.

Нужен **байт-прозрачный** forward: iptables DNAT/SNAT. Ядро не читает TLS и не
пересобирает ClientHello.

## Целевая схема

```
телефон
  → 136.148.213.105:443          (публичный IP фронта rel-all-work)
  → iptables DNAT (PREROUTING)
  → 10.202.120.54:443            (нода 54 по HostUp LAN)
  ← SNAT source 10.202.120.2     (чтобы ответ шёл тем же путём)
  → Xray Reality на 54-rel
```

Публичный `143.14.50.32:443` остаётся закрытым (`exit-hide.nft`).

| Роль | Хост | Публичный IP | LAN |
|------|------|--------------|-----|
| Фронт | `rel-all-work` | `136.148.213.105` | `10.202.120.2/24` (`eth1`) |
| Exit / Слон | `54-rel` | `143.14.50.32` | `10.202.120.54/24` (`eth1`) |

## Что делает cutover

На фронте:

1. Бэкап `/etc/haproxy/haproxy.cfg`.
2. Убирает `frontend tcp443` / bind `:443` (чтобы локальный слушатель не мешал диагностике).
3. Ставит **TCP** DNAT `136.148.213.105:443` → `10.202.120.54:443` + SNAT `10.202.120.2`.
4. Оставляет / чинит **UDP** DNAT тем же путём (как раньше для HY2).
5. `ip_forward=1`, `TCPMSS --clamp-mss-to-pmtu`, persist через systemd unit.
6. Проверяет ping и TCP до `10.202.120.54:443` с фронта.

На ноде 54 ничего менять не нужно, если уже есть:

- Xray Reality на `:443` (или через локальный bridge);
- `private-front-allow` для `10.202.120.0/24`;
- публичный `:443` закрыт снаружи.

`finalMask` на хосте Слона в панели **не трогать** (`tlshello`, `20–50`, delay `0`).

## Запуск с машины агента

```bash
export HANDOFF_SSH_PRIVATE_KEY_FILE=/path/to/id_ed25519
# или: export HANDOFF_SSH_PRIVATE_KEY="$(cat id_ed25519)"

bash tmpl-install/slon-front/remote-cutover.sh
# откат:
bash tmpl-install/slon-front/remote-cutover.sh --rollback
```

На самом фронте (если уже под root):

```bash
bash apply-tcp-dnat.sh
bash apply-tcp-dnat.sh --rollback
```

## Проверка после cutover

```bash
# с фронта
ping -c1 -W2 10.202.120.54
iptables -t nat -S | grep -E '443|10.202.120.54'
ss -lntu | awk '/:443 /'   # локального LISTEN на 443 быть не должно

# снаружи: TCP SYN до 136.148.213.105:443 должен уходить на ноду
# В Happ: обновить подписку → у Слона есть finalMask → коннект 2–3 мин
```

## Откат

`apply-tcp-dnat.sh --rollback` снимает TCP/UDP DNAT unit и возвращает последний
бэкап `haproxy.cfg` с `frontend tcp443` → `b_slon_reality`.
