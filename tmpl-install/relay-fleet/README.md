# Relay fleet: план, inventory, авто-failover DNS

Пакет для парка **релей SERV.HOST → exit Hostup (Hiddify/tmpl)**.

## Ответ на главный вопрос

**Да.** Целевая автоматика такая:

1. Скрипт сам проверяет путь `релей → exit`.
2. Если primary мёртв, а backup жив — **сам меняет A-записи в Cloudflare** на backup IP.
3. Шлёт алерт (Telegram/лог).
4. **Вы** только докупаете новые IP на SERV.HOST, прописываете DNAT заранее и добавляете IP в `inventory.yaml` (в пул / backup). Скрипт IP у хостера не покупает.

Клиентские ссылки не переиздаём: меняется только DNS фронта.

## Файлы

| Файл | Назначение |
|------|------------|
| [PLAN.md](./PLAN.md) | Архитектура, роли, что не делать |
| [AGENT-PROMPT.md](./AGENT-PROMPT.md) | Промпт для другой нейросети/агента |
| [inventory.example.yaml](./inventory.example.yaml) | Пример inventory (скопировать в `inventory.yaml`) |
| [scripts/probe_and_failover.py](./scripts/probe_and_failover.py) | Пробы + DNS flip |
| [scripts/apply_relay_dnat.sh](./scripts/apply_relay_dnat.sh) | Единый DNAT на реле (обёртка над `../relay.sh`) |
| [systemd/](./systemd/) | Пример timer на контроллере |

## Быстрый старт

```bash
cd tmpl-install/relay-fleet
cp inventory.example.yaml inventory.yaml   # заполнить реальными IP
export CF_TOKEN='…'                        # Cloudflare API token (Zone.DNS Edit)
# optional: export TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=…

# сухой прогон (только отчёт, DNS не трогает)
python3 scripts/probe_and_failover.py --inventory inventory.yaml --dry-run

# боевой flip при деградации primary
python3 scripts/probe_and_failover.py --inventory inventory.yaml --apply
```

На каждом **backup** IP заранее:

```bash
# на машине релея, где висит этот IP
bash ../relay.sh --exit <EXIT_IP>
```

## Секреты

- `CF_TOKEN` / `CF_API_TOKEN` — в env или файл из `cf_token_file` в inventory.
- SSH: ключ как у парка (`ssh_key` в inventory), BatchMode.
- `inventory.yaml` с боевыми IP **не коммитить** (см. `.gitignore` рядом).
