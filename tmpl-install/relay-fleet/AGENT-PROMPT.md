# Промпт для агента / другой нейросети

Скопируйте блок ниже целиком в новый чат (плюс при необходимости `PLAN.md`).

Актуально на: **2026-10-29 ~12:15 Europe/Moscow**.  
Полный парк exit (оператор): **8, 12, 14, 15, 20, 36, 37, 51, 54, 57, 58, 60, 61**.

---

## Контекст

Ты ведёшь **весь** парк VPN ниже, не только «проблемные» ноды.

- **Exit** = Hostup `136.148.*` (Hiddify 12 + tmpl animals: sova/tigr/utka/ryba).
- **Фронт (релей)** = обычно SERV.HOST, `iptables` DNAT + MASQUERADE (`tmpl-install/relay.sh` / multi-IP DNAT).
- Клиентские subscription URL **не переиздавать** — только DNS A на фронт (TTL 60, proxied=false).
- Клиент = **Happ**. Протоколы (животные) и обновление подписки — разные пути: animals = не-443 порты через DNAT; sub = **HTTPS TCP/443** на фронт.

Канон в репо: `tmpl-install/relay-fleet/` (`PLAN.md`, скрипты). Боевой `inventory.yaml` и ключи — у оператора / agent store, **не в git**.

SSH ключ парка (если уже стоит): `~/.ssh/tmpl-audit-temp`. CF: env `CF_TOKEN` или `/tmp/cf.token`.

---

## Полная карта парка (все exit)

DNS сверено dig @1.1.1.1 на дату актуальности. Primary DNS → = куда смотрят клиентские A.

| Exit | Exit IP | Primary DNS → | Primary host | Примечание |
|------|---------|---------------|--------------|------------|
| **8** | `136.148.220.239` | `179.254.132.91` | karaforum2 (`144.31.107.31`) | backup `179.254.132.94` на karaforum3; путь часто через WG-хоп |
| **12** | `136.148.219.217` | `179.254.132.92` | karaforum3 | снят с бывшего `13.143.137.112` (тот IP ловил ТСПУ); аварийный `.92` раньше был backup 60 |
| **14** | `136.148.211.88` | `2.26.10.197` | karaforum6 | свой релей; без аварийного IP |
| **15** | `136.148.219.149` | `13.143.137.92` | karaforum13 | фронт на `13.143.137.92` — **чистый, ТСПУ не блочит** (оператор); не переносить «из принципа» |
| **20** | `136.148.220.240` | `2.26.8.81` | karaforum17 | без аварийного IP; на exit нужен `tmpl-sub` с `do_HEAD` |
| **36** | `136.148.222.86` | `2.26.89.101` | karaforum9 | свой релей; без аварийного IP |
| **37** | `136.148.220.248` | `31.76.71.236` | karaforum.serv.host | фронт не из пула `2.26`/`144.31`/`179.254` |
| **51** | `136.148.212.77` | `2.26.10.183` | karaforum5 | свой релей; без аварийного IP |
| **54** | `136.148.223.248` | `144.31.49.147` | karaforum8 | свой релей; без аварийного IP |
| **57** | `136.148.211.77` | `179.254.132.90` | karaforum12 (`80.66.89.19`) | backup `179.254.132.95` на karaforum3; WG-хоп возможен |
| **58** | `136.148.211.101` | `2.26.89.168` | karaforum10 | свой релей; без аварийного IP |
| **60** | `136.148.220.250` | `179.254.132.93` | karaforum4 (`2.26.10.27`) | холодный backup `144.31.50.159` (karaforum17); OS-IP `2.26.10.27` в DNS клиентам **не светить** |
| **61** | `136.148.221.77` | `144.31.49.87` | karaforum7 | свой релей; без аварийного IP |

**Авто-failover (probe timer / inventory)** сейчас в бою обычно только для exit с запасным IP: **8, 12, 20, 57, 60**. Остальные — в полной карте; чинить/DNS flip по запросу оператора; в inventory их тоже держать, чтобы агент не «забывал» парк.

**Аварийный пул karaforum3:** SSH `179.254.132.92`, доп. IP `.94 .95`.  
DNAT: `.92→12`, `.94→8`, `.95→57`.

**Важно:** IP в панели SERV.HOST ≠ адрес в ОС. Если «no route» → `ip addr add IP/32 dev ens3` + `/etc/network/interfaces`.

### Домены по exit (все A → primary фронт, не на `136.148.*`)

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

**`*.sarafan.uk` — забыть.** Не чинить, не failover, не DNS flip.

**Чужие/старые альты (не tmpl):** `a1212`/`z1212`/`a20`/`z20` → `188.127.240.127` (чужой nginx HTML). **Не трогать** без явной просьбы оператора.

---

## Золотое правило DNS

**Никогда не оставлять клиентские A на прямой Hostup `136.148.*`.**

С части RU-путей (и с части SERV.HOST машин) TCP/443 до Hostup **таймаутит**, а animal-порты через фронт ещё живут → симптом: **«протоколы работают, подписка не обновляется»**.

Проверка: `dig +short A <domain> @1.1.1.1` — ответ = фронт из таблицы, не exit IP.

Исключение: админские/внутренние проверки с `--resolve` на exit — ок. В CF для клиентов — нет.

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

При ручном flip DNS — обновляй **все** домены exit’а из списка выше (включая `*.vele.uk` / `20.kirz.co.uk` / `f20.*`), не только `xN`.

---

## Диагностика: «не обновляется подписка» (Happ)

Симптом часто: протоколы (сова/тигр/утка/рыба) ок, кнопка обновления sub крутится / ошибка. LTE и Wi‑Fi могут вести себя по-разному (кэш DNS, DPI, Alt-Svc).

### Шаг 0 — снять параметры с exit

```bash
ssh -i ~/.ssh/tmpl-audit-temp root@EXIT_IP '
  python3 -c "import json;p=json.load(open(\"/etc/tmpl/params.json\"));print(p.get(\"domain\"),p.get(\"client_path\"),p.get(\"sub_domains\"))"
  grep -v "^#" /etc/tmpl/extra-uuids | head -1
'
```

Sub URL: `https://<domain>/<client_path>/<uuid>/`  
UA для smoke: `-A Happ/3.0`. Для HEAD добавить `-X HEAD -H "Connection: close" --max-time 12`.

### Шаг 1 — DNS всех доменов exit

```bash
for h in DOMAINS...; do echo -n "$h: "; dig +short A "$h" @1.1.1.1; done
```

Если хоть один смотрит на `136.148.*` (прямой Hostup) / мёртвый IP / **конкретно заблокированный** фронт → **CF A → живой фронт**, ttl 60, proxied false. Зоны: `kirz.co.uk`, `kirvpn.ru`, `kirvpn.us`, **`vele.uk`** (id в inventory).  
Не путать: `13.143.137.92` (exit 15) — ок; старый `13.143.137.112` (был у 12) — ТСПУ. Префикс `13.143.*` сам по себе не = «сносить».

### Шаг 2 — smoke снаружи и с RU-релея

С контроллера (зарубежье) мало: с части путей Hostup «жив», а у абонента нет.

Обязательно прогнать **с SERV.HOST** (karaforum2/12/17), где путь до Hostup часто мёртв:

```bash
ssh -i ~/.ssh/tmpl-audit-temp root@80.66.89.19 '
  curl -sk -o /dev/null -w "%{http_code}|%{remote_ip}|%{time_total}\n" \
    -A Happ/3.0 --max-time 12 -H "Connection: close" \
    "https://DOMAIN/CLIENT_PATH/UUID/"
  curl -sk -o /dev/null -w "HEAD %{http_code}\n" \
    -A Happ/3.0 --max-time 12 -H "Connection: close" -X HEAD \
    "https://DOMAIN/CLIENT_PATH/UUID/"
'
```

Ожидание: **GET 200** и **HEAD 200**, `remote_ip` = фронт.

Если GET 000/timeout и dig = Hostup → чини DNS.  
Если dig = фронт, а timeout → DNAT/REJECT/haproxy на реле или exit.

### Шаг 3 — REJECT UDP/443 на реле фронта

Симптом особенно на **LTE**: Happ лезет в HTTP/3 (UDP/443); МТС часто **молча дропает** UDP → вечный кружок. TCP/443 при этом живой → протоколы ок.

На **каждом** реле фронта:

```text
nat PREROUTING: -p udp --dport 443 -j RETURN   # не DNAT на exit
INPUT:          -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

Остальной UDP (hy2 `36099` и т.д.) **DNAT** на exit. Режем только UDP **443**.

Проверка:

```bash
iptables -S INPUT | grep 443
iptables -t nat -S PREROUTING | head
# или цепочка TMPL-RELAY
iptables -t nat -S TMPL-RELAY
```

Ставить через `relay.sh` / `fix-all.sh --relay` / `apply_relay_dnat.sh`, не одноразовый ручной rule без persist.

### Шаг 4 — h3 / quic на exit

На haproxy exit:

- желательно ответ `alt-svc: clear` на sub;
- bind `quic4@:443` лучше **закомментировать** (`# tmpl-no-h3`), иначе клиент снова цепляется к h3.

Не снимать REJECT на реле «чтобы заработал h3» — вернёт кружок на LTE.

### Шаг 5 — tmpl-sub понимает HEAD

Happ иногда шлёт **HEAD** перед/вместо GET.

```bash
# на exit
grep -n do_HEAD /etc/tmpl/sub.py
# снаружи
curl -sk -o /dev/null -w "%{http_code}\n" -X HEAD -A Happ/3.0 \
  -H "Connection: close" --max-time 12 "https://xN.../path/uuid/"
```

Нужно: `do_HEAD` → `do_GET(head=True)` и ответ **200** (не 501).  
Если 501 — взять актуальный `/etc/tmpl/sub.py` с рабочего exit (12/60) или из dist, `systemctl restart tmpl-sub`, снова HEAD+GET.

Локальный curl к `:2099` без `-H "Connection: close"` на HEAD может «висеть» из‑за Content-Length — для проверки всегда `Connection: close` и `--max-time`.

### Шаг 6 — DNAT и путь релей→exit

```bash
# на реле фронта
iptables -t nat -S | grep -E "DNAT|443|TMPL"
# с релея: TCP 443×5 до EXIT_IP
```

Primary мёртв, backup жив → flip DNS на backup (скрипт или руками). Failback сам не делать.

### Шаг 7 — отчёт оператору

Кратко: какие домены dig’ом куда; GET/HEAD с какого релея; REJECT на месте; что поменял в CF / sub.py. Попросить перепроверить Happ на Wi‑Fi и LTE (DNS TTL 60 — подождать минуту при кэше).

---

## REJECT UDP/443 — шпаргалка «эджект»

Оператор говорит «эджект» = **REJECT UDP/443 на реле**, не параметр панели и не DNS-failover.

1. Клиент помнит HTTP/3.  
2. Happ при update sub часто сначала UDP/443.  
3. LTE UDP drop без ICMP → кружок.  
4. REJECT icmp-port-unreachable → Happ сразу на TCP/443 → sub ок.

---

## Роли

| Кто | Делает |
|-----|--------|
| Оператор | Покупает IP; пишет `exit: N`, `new_ip`, `host`; пароли только в чат |
| Агент | DNAT, `ip addr` если IP только в панели, probe, DNS всех доменов, inventory, tmpl-sub/REJECT |
| Скрипт | DNS flip primary→backup при мёртвом пути |

## Пароли и доступ

- **В md / git пароли не писать.**
- Оператор даёт root-пароль **только в чат** → агент ставит ключ `tmpl-audit-temp.pub` → дальше BatchMode.
- Боевые секреты: оператор / `/cursor/stores/self/…`, не PR.

---

## Типовые команды оператора → действия

| Фраза | Действие |
|-------|----------|
| «новый IP для N: x.x.x.x на host» | `ip addr` → DNAT → REJECT → probe 5/5 → DNS **всех** доменов N → inventory |
| «N не обновляется» / «протоколы ок» | Чеклист диагностики выше (DNS Hostup? HEAD 501? REJECT? RU-smoke?) |
| «откатили / верни на старый» | CF A на указанный IP |
| «на временный» | DNS на `.92`/`.94`/`.95` по таблице exit |
| «делай reject» | UDP/443 REJECT+RETURN на указанном реле + persist |

---

## Чеклист: новый IP для exit N

1. SSH на host; нет IP в `ip -4 addr` → `ip addr add …/32` + `/etc/network/interfaces`.
2. Multi-IP DNAT: `-d NEW_IP` → exit (SSH и udp/443 local RETURN). Или `apply_relay_dnat.sh`.
3. REJECT UDP/443 на этом реле.
4. С релея: TCP 443×5 до exit ≥3/5 (лучше 5/5).
5. Inventory: primary/backup + полный список domains.
6. CF A **всех** доменов exit → новый primary (ttl 60, proxied false). Зона `vele.uk` если есть `*.vele.uk`.
7. Smoke GET+HEAD `-A Happ/3.0` с RU-релея → 200, remote_ip = новый фронт.
8. Короткий отчёт.

---

## Cloudflare

Зоны в работе: `kirz.co.uk`, `kirvpn.ru`, `kirvpn.us`, `vele.uk` (для 12).  
`sarafan.uk` — **игнор**.  
Только A, `proxied: false`, TTL 60 для клиентских фронтов.

Zone id — в боевом inventory / example.

---

## Запрещено без явной просьбы

- Оранжевый CF на Reality / `x*` доменах.
- Менять `client_path` / UUID / переиздавать ссылки.
- DNAT/SSH на чужие exit не из задачи.
- Коммитить боевой inventory, `CF_TOKEN`, пароли.
- Failback DNS без `--failback`.
- SmartApe → Hostup; возвращать клиентский DNS на **заведомо плохой** фронт (пример: бывший `13.143.137.112` у 12). Живой `13.143.137.92` (15) не трогать без просьбы.
- Сносить REJECT UDP/443 «ради h3».
- Трогать `aN`/`zN` альты на `188.127.*` без просьбы.
- Чинить `*.sarafan.uk`.

---

## Известный долг / нюансы

- 8 и 57: primary на своих машинах, путь до Hostup может идти через **WG-хоп** (`wg8hop` → karaforum17). Аварийные IP на karaforum3 — прямой DNAT, предпочтительнее при аварии.
- `2.26.10.27` (OS-IP karaforum4) в DNS клиентам **не светить** — из РФ для sub уже не заходил; светить `.93`.
- Не удалять без нужды: `144.31.50.159` (cold 60), karaforum17 как релей 20.
- Можно снести: SmartApe `109.238.93.201`; лишний `13.143.137.35`; мусор `179.254.132.0` на karaforum2.
- Exit 20 раньше отдавал HEAD **501** (старый `sub.py` без `do_HEAD`) — после копирования с 12/60 → 200. При новых установках проверять HEAD.
- Wi‑Fi vs LTE: если один канал ок, а другой нет — сначала dig/кэш TTL и REJECT; не ломать то, что работает на втором канале.

---

## Стиль ответа оператору

Кратко: что сделано, DNS куда смотрит, smoke GET/HEAD 200/нет (с какого релея), REJECT на месте ли. Без лекций, если не просят. Времена — Europe/Moscow.

---
