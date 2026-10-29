# Промпт для агента / другой нейросети

Скопируйте этот файл целиком в новый чат (плюс при необходимости `PLAN.md`).

Актуально на: **2026-10-29 ~12:45 Europe/Moscow**.  
Полный парк exit: **8, 12, 14, 15, 20, 36, 37, 51, 54, 57, 58, 60, 61**.

---

## Контекст и канон архитектуры

Ты ведёшь **весь** парк ниже.

- **Exit** = Hostup `136.148.*` (Hiddify + tmpl animals: sova/tigr/utka/ryba).
- **Фронт (релей)** = обычно SERV.HOST. На реле: `iptables` DNAT + MASQUERADE (`tmpl-install/relay.sh` / multi-IP DNAT).
- **Модель оператора (обязательно):** каждому exit — **свой релей и свой купленный IP** как primary. Не «несколько exit на одном primary-IP».
- Клиентские subscription URL **не переиздавать** — только DNS A на фронт (TTL 60, `proxied: false`).
- Клиент = **Happ**. Animals = не-443 порты через DNAT; обновление sub = **HTTPS TCP/443** на фронт.

Канон в репо: `tmpl-install/relay-fleet/`. Боевой `inventory.yaml` и ключи — у оператора / agent store (`/cursor/stores/self/relay-fleet/`), **не в git**.

SSH: `~/.ssh/tmpl-audit-temp`. CF: `CF_TOKEN` или `/tmp/cf.token`.

---

## Полная карта парка

Primary DNS → = клиентские A (dig @1.1.1.1). **Сейчас все 13 на своём primary.**

| Exit | Exit IP | Primary DNS → | Primary host | Примечание |
|------|---------|---------------|--------------|------------|
| **8** | `136.148.220.239` | `179.254.132.91` | karaforum2 (`144.31.107.31`) | свой IP; backup DNAT `.94` на karaforum3; **релей→exit через WG** (см. ниже) |
| **12** | `136.148.219.217` | `13.143.137.112` | karaforum11 | свой релей |
| **14** | `136.148.211.88` | `2.26.10.197` | karaforum6 | свой |
| **15** | `136.148.219.149` | `13.143.137.92` | karaforum13 | `13.143.137.92` **чистый, ТСПУ не блочит** (оператор) |
| **20** | `136.148.220.240` | `2.26.8.81` | karaforum17 | свой; на exit `tmpl-sub` с `do_HEAD` |
| **36** | `136.148.222.86` | `2.26.89.101` | karaforum9 | свой |
| **37** | `136.148.220.248` | `31.76.71.236` | karaforum.serv.host | свой (не пул `2.26`/`144.31`/`179.254`) |
| **51** | `136.148.212.77` | `2.26.10.183` | karaforum5 | свой |
| **54** | `136.148.223.248` | `144.31.49.147` | karaforum8 | свой |
| **57** | `136.148.211.77` | `179.254.132.90` | karaforum12 (`80.66.89.19`) | свой IP; backup DNAT `.95` на karaforum3; **релей→exit через WG** |
| **58** | `136.148.211.101` | `2.26.89.168` | karaforum10 | свой |
| **60** | `136.148.220.250` | `179.254.132.93` | karaforum4 (`2.26.10.27`) | свой `.93`; холодный backup `144.31.50.159` на karaforum17; OS-IP `2.26.10.27` клиентам **не светить** |
| **61** | `136.148.221.77` | `144.31.49.87` | karaforum7 | свой |

### Домены (все A → primary фронт, никогда на `136.148.*`)

- **8:** `x8.kirz.co.uk`, `hid8.kirvpn.ru`, `hid8.kirvpn.us`
- **12:** `x12.kirz.co.uk`, `1212.kirvpn.ru`, `1212.kirvpn.us`, `1212.vele.uk`
- **14:** `x14.kirz.co.uk`, `14.kirvpn.ru`, `14.kirvpn.us`
- **15:** `x15.kirz.co.uk`, `15.kirvpn.ru`, `15.kirvpn.us`
- **20:** `x20.kirz.co.uk`, `20.kirz.co.uk`, `20.kirvpn.ru`, `20.kirvpn.us`, `f20.kirvpn.ru`
- **36:** `x36.kirz.co.uk`, `36.kirvpn.ru`, `36.kirvpn.us`
- **37:** `x37.kirz.co.uk`, `37.kirvpn.ru`, `37.kirvpn.us`
- **51:** `x51.kirz.co.uk`, `51.kirvpn.ru`, `51.kirvpn.us`
- **54:** `x54.kirz.co.uk`, `54.kirvpn.ru`, `54.kirvpn.us`
- **57:** `x57.kirz.co.uk`, `57.kirz.co.uk`, `57.kirvpn.ru`, `57.kirvpn.us`
- **58:** `x58.kirz.co.uk`, `58.kirvpn.ru`, `58.kirvpn.us`
- **60:** `x60.kirz.co.uk`, `60.kirvpn.ru`, `60.kirvpn.us`, `bs1.kirvpn.ru`, `bs1.kirvpn.us`
- **61:** `x61.kirz.co.uk`, `61.kirvpn.ru`, `61.kirvpn.us`

**`*.sarafan.uk` — забыть.**  
**Альты `aN`/`zN` → `188.127.240.127`** — чужой nginx, не tmpl; не трогать без просьбы.

---

## Временный / аварийный пул (karaforum3)

SSH: `179.254.132.92`. Доп. IP на той же машине: `.94`, `.95`.

| IP | Назначение сейчас |
|----|-------------------|
| **`.92`** | **Пустой временный.** Нет клиентского DNS. Нет DNAT на exit. Только local RETURN (ssh / udp443). |
| **`.94`** | Заранее DNAT → exit **8** (backup). DNS сам не переключать. |
| **`.95`** | Заранее DNAT → exit **57** (backup). DNS сам не переключать. |

### Правила временного (оператор жёстко)

1. **Primary у каждого exit — свой релей.** Временный не заменяет «навсегда».
2. Команда **«на временный»** = на время аварии перенести DNS exit’а на свободный аварийный IP (обычно `.92`, с DNAT на нужный exit).
3. После аварии — **вернуть DNS на свой релей**, освободить временный (убрать клиентский DNS + DNAT с `.92`, если он был занят).
4. **Без явной команды** не вешать exit primary на `.92` и не оставлять его там после фикса.
5. Ошибка прошлого агента: exit 12 после аварии sub оставили на `.92`; оператор вернул правило «временный пустой». Сейчас 12 снова на karaforum11.

На karaforum3 путь до Hostup **прямой 5/5** (без WG) — поэтому он удобен как аварийный фронт.

---

## WG-хоп у 8 и 57 (это не «чужой релей»)

Оператор докупил front-IP **`.91` (8)** и **`.90` (57)** на **своих** машинах — клиентский DNS смотрит туда. Это сделано правильно.

**WG (`wg8hop` → karaforum17 `2.26.8.81`) — другой слой:** туннель **релей → Hostup**, не клиентский фронт.

Почему остался (проверено 2026-10-29):

- с karaforum2 без WG-маршрута до exit 8 (`136.148.220.239`) → **0/5** TCP 443;
- с karaforum12 без WG до exit 57 (`136.148.211.77`) → **0/5**;
- с маршрутом через `wg8hop` — живой трафик (сотни GiB).

Новый front-IP **не чинит** доступ машины до Hostup. Пока прямой путь 0/5 — WG нужен, иначе DNAT на exit мёртвый.

**Не снимать WG** «потому что купили IP», пока `ip route del … dev wg8hop` + probe 443 не даст стабильные ≥3/5 (лучше 5/5). Потом можно убрать хоп и оставить чистый DNAT.

Проверка:

```bash
# на karaforum2 / karaforum12
wg show
ip route get EXIT_IP          # сейчас часто: dev wg8hop
# краткий тест «настоящего» прямого (осторожно, мигает путь):
ip route del EXIT_IP dev wg8hop
# probe TCP 443×5 к EXIT_IP
ip route replace EXIT_IP dev wg8hop   # вернуть сразу, если 0/5
```

---

## Золотое правило DNS

**Клиентские A никогда на прямой Hostup `136.148.*`.**

Иначе с части RU: HTTPS/sub таймаут, а animals через фронт ещё живут → «протоколы ок, подписка нет».

`dig +short A <domain> @1.1.1.1` = фронт из таблицы.

Префикс `13.143.*` **не** = автоматически ТСПУ. `13.143.137.92` (15) — ок. Конкретный плохой IP не использовать; не обобщать на весь префикс.

---

## Авто-failover

Скрипт `probe_and_failover.py`: SSH с машины фронта, TCP 443×N до exit; primary мёртв + backup жив → CF A всех доменов exit → backup.  
Failback **выкл** по умолчанию (`auto_failback: false`).

**Backup front-IP сейчас только у 8, 57, 60.** У **20 backup нет** (и это риск: 20 сидит на karaforum17 вместе с WG-хопом 8/57 и cold-IP 60).  
У остальных exit (12,14,15,36,37,51,54,58,61) backup нет — только свой primary; «на временный» руками.  
Весь парк всё равно держать в inventory/карте.

```bash
python3 tmpl-install/relay-fleet/scripts/probe_and_failover.py \
  --inventory /cursor/stores/self/relay-fleet/inventory.yaml --dry-run
# бой: ... --apply
```

Ручной flip — **все** домены exit’а из списка, не только `xN`.

---

## Диагностика: «не обновляется подписка» (Happ)

### 0) Параметры с exit

```bash
ssh -i ~/.ssh/tmpl-audit-temp root@EXIT_IP '
  python3 -c "import json;p=json.load(open(\"/etc/tmpl/params.json\"));print(p.get(\"domain\"),p.get(\"client_path\"),p.get(\"sub_domains\"))"
  grep -v "^#" /etc/tmpl/extra-uuids | head -1
'
```

URL: `https://<domain>/<client_path>/<uuid>/`  
Smoke: `-A Happ/3.0`. HEAD: `-X HEAD -H "Connection: close" --max-time 12`.

### 1) DNS всех доменов exit

Любой A на `136.148.*` / мёртвый IP → CF на живой **свой** фронт (или временный — только по команде).

### 2) Smoke с RU-релея (обязательно)

С контроллера за рубежом Hostup часто «жив», у абонента нет. Гонять с SERV.HOST (karaforum2/12/17):

```bash
curl -sk -o /dev/null -w "%{http_code}|%{remote_ip}|%{time_total}\n" \
  -A Happ/3.0 --max-time 12 -H "Connection: close" "https://DOMAIN/CP/UUID/"
curl -sk -o /dev/null -w "HEAD %{http_code}\n" \
  -A Happ/3.0 --max-time 12 -H "Connection: close" -X HEAD "https://DOMAIN/CP/UUID/"
```

Ждём GET **200** + HEAD **200**, `remote_ip` = фронт.

### 3) REJECT UDP/443 на реле («эджект»)

LTE: Happ → HTTP/3 UDP/443 → МТС часто silent drop → кружок; TCP живой.

На каждом реле фронта:

- nat: `-p udp --dport 443 -j RETURN`
- INPUT: `-p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable`

Остальной UDP (hy2 и т.д.) DNAT. Persist через `relay.sh` / `fix-all.sh --relay`.

### 4) h3 на exit

`alt-svc: clear`; bind `quic4@:443` лучше закомментировать (`# tmpl-no-h3`).  
Не снимать REJECT «ради h3».

### 5) tmpl-sub и HEAD

Нужен `do_HEAD` → `do_GET(head=True)`, ответ 200 (не 501).  
Если 501 — актуальный `sub.py` с рабочего exit, `systemctl restart tmpl-sub`.

### 6) DNAT + путь релей→exit (+ WG для 8/57)

```bash
iptables -t nat -S TMPL-RELAY
# probe 443×5 до EXIT; для 8/57 смотреть wg show / ip route get
```

### 7) Отчёт

DNS куда; GET/HEAD с какого релея; REJECT; WG затронут?; что в CF. Времена — Europe/Moscow.

---

## Типовые команды оператора

| Фраза | Действие |
|-------|----------|
| «новый IP для N: x.x.x.x на host» | `ip addr` → DNAT → REJECT → probe → DNS всех доменов N на **этот** IP → inventory. Primary остаётся 1:1. |
| «N не обновляется» / «протоколы ок» | Чеклист диагностики |
| «на временный» | Поднять DNAT на свободном аварийном IP (обычно `.92`) → DNS exit’а туда. **После фикса — вернуть на свой релей, `.92` снова пустой.** |
| «верни на свой» / «временный пустой» | DNS на primary из таблицы; с `.92` снять клиентский DNS и DNAT на exit |
| «откатили» | CF A на указанный IP |
| «делай reject» | UDP/443 REJECT+RETURN + persist |
| «убери WG у 8/57» | Только после доказанного прямого ≥3/5; иначе не трогать |

---

## Чеклист: новый IP для exit N

1. SSH на **свой** host exit’а; IP в ОС (`ip addr add …/32` + interfaces при необходимости).
2. DNAT `-d NEW_IP` → exit (ssh/udp443 local). `apply_relay_dnat.sh` ок.
3. REJECT UDP/443.
4. С релея: TCP 443×5 до exit. Если 0/5 напрямую — не врать оператору; для 8/57 возможен WG; аварийный karaforum3 обычно прямой 5/5.
5. Inventory + CF A **всех** доменов → новый primary (ttl 60, proxied false). `vele.uk` для доменов 12.
6. Smoke GET+HEAD с RU-релея.
7. Короткий отчёт. Временный `.92` не занимать этим IP.

---

## Cloudflare

Зоны: `kirz.co.uk`, `kirvpn.ru`, `kirvpn.us`, `vele.uk`.  
`sarafan.uk` — игнор.  
A, `proxied: false`, TTL 60. Zone id — в inventory.

---

## Запрещено без явной просьбы

- Оранжевый CF на Reality / `x*`.
- Менять `client_path` / UUID / переиздавать ссылки.
- Коммитить боевой inventory, токены, пароли.
- Failback DNS без `--failback`.
- Вешать primary на временный `.92` или **оставлять** его там после аварии.
- Снимать WG 8/57 без проверки прямого пути.
- Сносить REJECT «ради h3».
- Трогать `aN`/`zN` / `*.sarafan.uk`.
- SmartApe → Hostup; светить `2.26.10.27` клиентам вместо `.93`.

Пароли: только в чат → ключ `tmpl-audit-temp.pub` → BatchMode. В md/git не писать.

---

## Известный долг / аудит рисков

- **karaforum17 SPOF:** primary 20 + WG-хоп 8/57 + cold backup 60. Падение 17 → ляжет 20; 8/57 тоже (фронты живы, путь до exit через WG мёртв). Probe TCP фронт→exit для 8/57 идёт **через WG**, поэтому смерть 17 может выглядеть как «exit мёртв» или глючить; падение «клиент→фронт» probe **не видит**.
- 8/57: клиентский фронт свой; до Hostup пока WG. Прямой путь 0/5 (на дату актуальности). Не снимать WG без проверки.
- Холодный `144.31.50.159` — backup 60 на karaforum17; лучше со временем увести с той же машины, что WG/20.
- У 20 нет backup IP — приоритет докупки.
- Probe не проверяет WG-handshake отдельно и не проверяет доступность фронта снаружи — ложные/слепые зоны возможны.
- Корень `/` у части нод даёт 302/403/таймаут (decoy) — **не диагноз**. Смотреть `/<client_path>/<uuid>/` GET+HEAD. (x14 root 302, x15 root 403 — норма; sub 200. x61 root иногда тупит, sub/HEAD 200, `do_HEAD` есть.)
- Мусор/кандидаты на снос: SmartApe `109.238.93.201`; `13.143.137.35`; `179.254.132.0` на karaforum2 — только с согласия.
- Wi‑Fi vs LTE: dig/кэш/REJECT; не ломать рабочий канал вслепую.

---

## Стиль ответа оператору

Кратко: что сделано, DNS куда, smoke GET/HEAD, REJECT, WG если затронут, временный пустой ли. Без лекций. Europe/Moscow.

---
