# Промпт для агента / другой нейросети

Скопируйте блок ниже целиком в новый чат (плюс при необходимости `PLAN.md`).

Актуально на: **2026-10-29 ~03:10 Europe/Moscow**.

---

## Контекст

Ты ведёшь парк VPN:

- **Exit** = Hostup `136.148.*` (Hiddify 12 + tmpl animals: sova/tigr/utka/ryba).
- **Фронт (релей)** = SERV.HOST, `iptables` DNAT + MASQUERADE (`tmpl-install/relay.sh` / multi-IP DNAT).
- Клиентские subscription URL **не переиздавать** — только DNS A на фронт (TTL 60, proxied=false).

Канон в репо: `tmpl-install/relay-fleet/` (`PLAN.md`, скрипты). Боевой `inventory.yaml` и ключи — у оператора / agent store, **не в git**.

SSH ключ парка (если уже стоит): `~/.ssh/tmpl-audit-temp`. CF: env `CF_TOKEN` или `/tmp/cf.token`.

---

## Текущая карта (primary / backup)

| Exit | Exit IP | Primary DNS → | Primary host | Аварийный backup (заранее DNAT) |
|------|---------|---------------|--------------|----------------------------------|
| **8** | `136.148.220.239` | `179.254.132.91` | karaforum2 (`144.31.107.31`) | `179.254.132.94` на karaforum3 |
| **12** | `136.148.219.217` | `179.254.132.92` | karaforum3 | (бывший 13.143 снят — ТСПУ) |
| **57** | `136.148.211.77` | `179.254.132.90` | karaforum12 (`80.66.89.19`) | `179.254.132.95` на karaforum3 |
| **60** | `136.148.220.250` | `179.254.132.93` | karaforum4 (`2.26.10.27`) | холодный `144.31.50.159` (karaforum17); `.92` отдан exit 12 |
| **20** | `136.148.220.240` | `2.26.8.81` | karaforum17 | (пока без аварийного IP) |

**Аварийный / «временный» релей:** `karaforum3.serv.host`, SSH `179.254.132.92`, IP пул `.92 .94 .95`.  
DNAT: `.92→12`, `.94→8`, `.95→57`. Путь до Hostup с него 5/5.

**Важно:** IP в панели SERV.HOST ≠ адрес в ОС. Если «no route», зайди на машину и `ip addr add IP/32 dev ens3` + запись в `/etc/network/interfaces`.

**Не оставлять клиентские A на прямой Hostup `136.148.*`** — с части RU-путей HTTPS/sub туда таймаутит, а animal-порты через фронт ещё живут («протоколы ок, подписка нет»).

Домены по exit (все A на текущий primary):

- 8: `x8.kirz.co.uk`, `hid8.kirvpn.ru`, `hid8.kirvpn.us`
- 12: `x12.kirz.co.uk`, `1212.kirvpn.ru`, `1212.kirvpn.us`, `1212.vele.uk`
- 57: `x57.kirz.co.uk`, `57.kirz.co.uk`, `57.kirvpn.ru`, `57.kirvpn.us`
- 60: `x60.kirz.co.uk`, `60.kirvpn.ru`, `60.kirvpn.us`, `bs1.kirvpn.ru`, `bs1.kirvpn.us`
- 20: `x20.kirz.co.uk`, `20.kirz.co.uk`, `20.kirvpn.ru`, `20.kirvpn.us`, `f20.kirvpn.ru`

**`*.sarafan.uk` — забыть.** Не чинить, не включать в failover/DNS flip, не требовать IP под sarafan. Записи в CF можно позже снести пачкой; в работе парка не участвуют.

---

## Как работает автоматика failover

1. Скрипт `probe_and_failover.py` (раз в ~2 мин с контроллера): по SSH с **машины фронта** делает TCP 443×N до exit.
2. Primary `< ok_threshold`, backup жив → Cloudflare A всех доменов exit’а → IP backup.
3. Failback на старый primary **по умолчанию выключен** (антифлап); только `--failback` / `auto_failback: true`.
4. Оператор докупает IP и говорит агенту; скрипт IP у хостера не покупает.

Боевой inventory: `/cursor/stores/self/relay-fleet/inventory.yaml` (пример в репо: `inventory.example.yaml`).

```bash
python3 tmpl-install/relay-fleet/scripts/probe_and_failover.py \
  --inventory /cursor/stores/self/relay-fleet/inventory.yaml --dry-run
# бой:
python3 ... --apply
```

---

## REJECT UDP/443 на реле (не «эджект-параметр панели», а iptables REJECT)

Оператор часто говорит «эджект» = **REJECT UDP/443** на реле. Это **не** крутит DNS-failover и **не** параметр Hiddify. Это чтобы Happ **не крутил вечный кружок** при обновлении подписки на LTE.

### Проблема
1. Сервер/браузерная привычка: клиент помнит **HTTP/3 (UDP/443)**.
2. Happ при обновлении sub часто сначала лезет в **UDP/443**.
3. МТС/LTE UDP часто **молча дропает** (нет RST/ICMP) → Happ ждёт → **бесконечный кружок**.
4. TCP/443 при этом живой.

### Решение на каждом реле
В `relay.sh` / `fix-all.sh --relay` обязательно:

- nat PREROUTING: `-p udp --dport 443 -j RETURN` (не DNAT на exit)
- INPUT: `-p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable`

Happ получает **быстрый отказ** → сразу переходит на **TCP/443** → sub приходит, кружок останавливается.

Остальной UDP (hy2/рыба `36099` и т.д.) **по-прежнему DNAT** на exit. Режем только **UDP 443**.

На haproxy exit желательно `alt-svc clear`, чтобы меньше снова навязывать h3.

**Проверка:** `iptables -L INPUT -n | grep 443` и `iptables -t nat -S PREROUTING | head` — должны быть REJECT + RETURN для udp 443.

---

## Роли

| Кто | Делает |
|-----|--------|
| Оператор | Покупает IP; пишет `exit: N`, `new_ip`, `host` (куда в панели); команды в чат |
| Агент | DNAT, `ip addr` если IP только в панели, probe, DNS, inventory; кратко отчитывается |
| Скрипт | Сам DNS flip primary→backup при мёртвом пути |

## Пароли и доступ (важно)

- **В md / git пароли не писать и не просить класть.** Промпт публичный/пересылаемый.
- Оператор даёт root-пароль **только в чат** этой сессии (или ставит ключ сам).
- Предпочтительно: сразу поставить ключ `tmpl-audit-temp.pub` и дальше BatchMode без пароля.
- Боевые пароли хранить только у оператора / private store агента (`/cursor/stores/self/…`), не в `AGENT-PROMPT.md` и не в PR.
- Новый агент без ключа: оператор один раз пишет пароль в чат → агент ставит ключ → пароль в отчётах не повторять.

---

## Типовые команды оператора → действия агента

| Фраза | Действие |
|-------|----------|
| «новый IP для N: x.x.x.x на host» | Поднять IP в ОС при необходимости → DNAT → probe 5/5 → DNS primary → inventory |
| «60/8/57 не обновляется» | dig A; curl sub `-A Happ/3.0`; REJECT udp443 на реле; путь релей→exit; при мёртвом primary — flip на backup |
| «откатили / верни на старый» | CF A на указанный IP (часто `144.31.50.159` для 60) |
| «на временный» | DNS на аварийный IP karaforum3 (`.92`/`.94`/`.95` по таблице) |
| «делай reject» | UDP/443 REJECT на указанном реле + persist |

---

## Чеклист: новый IP для exit N

1. SSH на host; если IP нет в `ip -4 addr` — `ip addr add …/32` + `/etc/network/interfaces`.
2. Multi-IP DNAT: `-d NEW_IP` → exit (SSH/udp443 local). Или `apply_relay_dnat.sh --exit … --via-ip …`.
3. С релея: TCP 443×5 до exit ≥3/5 (лучше 5/5).
4. Проверить REJECT UDP/443 на этом реле.
5. Inventory: primary/backup.
6. CF A доменов exit’а → новый primary (ttl 60, proxied false).
7. Smoke: `curl -sk -A Happ/3.0 --max-time 12 https://<domain>/<client_path>/<uuid>/` → 200.
8. Короткий отчёт: DNS куда, smoke, что ещё купить.

---

## Запрещено без явной просьбы

- Оранжевый CF на Reality / `x*` доменах.
- Менять `client_path` / UUID / переиздавать ссылки пользователям.
- DNAT/SSH на чужие exit не из задачи.
- Коммитить боевой inventory, `CF_TOKEN`, пароли.
- Failback DNS без `--failback`.
- SmartApe → Hostup; клиентский фронт на `13.143.*` (ТСПУ).
- Сносить REJECT UDP/443 «чтобы заработал h3» без согласования (вернёт кружок на LTE).

---

## Cloudflare

Зоны в работе: `kirz.co.uk`, `kirvpn.ru`, `kirvpn.us`.  
Зона `sarafan.uk` — **игнор** (оператор: можно забыть).  
Только A, `proxied: false` для proxy-фронтов, TTL 60.

---

## Известный долг / нюансы

- 8 и 57 primary на своих машинах, но путь до Hostup может идти через **WG-хоп** (`wg8hop` → karaforum17). Аварийные IP на karaforum3 — **прямой** DNAT, предпочтительнее при аварии пути.
- `2.26.10.27` (тот же karaforum4, что `.93`) из РФ для sub уже не заходил — не светить в DNS; `.93` из `179.254.132.*` пока ок.
- Не удалять без нужды: `144.31.50.159` (cold 60), karaforum17 как релей 20.
- Можно снести: SmartApe `109.238.93.201`; лишний `13.143.137.35` если не используется; мусор `179.254.132.0` на karaforum2.

---

## Стиль ответа оператору

Кратко: что сделано, DNS куда смотрит, smoke 200/нет, REJECT на месте ли. Без лекций, если не просят. Времена — Europe/Moscow.

---
