# Монитор записи к врачу (Дубна / Московская область)

Скрипт раз в N минут проверяет свободные талоны на [zdrav.mosreg.ru](https://zdrav.mosreg.ru/) и сразу пишет вам в Telegram, когда появляются места.

- Только **чтение** расписания — запись сам не создаёт
- Нужны номер полиса ОМС и дата рождения (как на портале)
- Лучше запускать с компьютера/VPS **в России** (портал часто недоступен из-за рубежа)

Готовый чужой бот с похожей идеей: [@zdrav_mosreg_subscribe_bot](https://t.me/zdrav_mosreg_subscribe_bot).  
Официальная запись: [@eregistratura_mo_bot](https://t.me/eregistratura_mo_bot) (Денис) или сайт / 122.

## Быстрый старт

```bash
cd appointment-monitor
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Откройте `.env` и заполните:

1. `OMS_NUMBER` — полис ОМС (только цифры)
2. `OMS_BIRTHDAY` — дата рождения в формате `ДД.ММ.ГГГГ`
3. Telegram (см. ниже)

### Telegram-оповещения

1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot` → получите `TELEGRAM_BOT_TOKEN`
2. Напишите своему боту любое сообщение
3. Узнайте `TELEGRAM_CHAT_ID`:
   - откройте `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - в ответе найдите `"chat":{"id": 123456789`
4. Впишите токен и chat id в `.env`
5. Проверка: `python monitor.py notify-test`

## Настройка «кого смотреть» (Дубна)

```bash
# 1) список специальностей → скопируйте id нужной
python monitor.py departments

# 2) больницы по специальности (ищите Дубну в адресе/названии)
python monitor.py hospitals <DEPARTMENT_ID>

# 3) врачи и текущие талоны
python monitor.py doctors <DEPARTMENT_ID> <LPU_CODE>
```

Впишите в `.env`:

```env
DEPARTMENT_ID=...   # из departments
LPU_CODE=...        # код больницы в Дубне (из hospitals)
DOCTOR_ID=          # опционально: конкретный врач
CHECK_INTERVAL_SEC=300
DAYS=21
```

## Запуск мониторинга

Одна проверка:

```bash
python monitor.py check
```

Постоянно (каждые 5 минут по умолчанию):

```bash
python monitor.py watch
```

Чтобы работало, пока компьютер выключен, оставьте скрипт на всегда включённом ПК / Raspberry Pi / дешёвом VPS в РФ, либо через `systemd` / Task Scheduler.

Пример `systemd` (Linux):

```ini
[Unit]
Description=Doctor appointment monitor
After=network-online.target

[Service]
WorkingDirectory=/path/to/appointment-monitor
ExecStart=/path/to/appointment-monitor/.venv/bin/python monitor.py watch
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

## Важно

- **Не коммитьте** `.env` и полис — в `.gitignore` это уже учтено
- Скрипт шлёт уведомление, когда талонов стало больше или набор дат изменился; повторно не спамит, пока картина та же
- Когда придёт оповещение — сразу записывайтесь на сайте или через [@eregistratura_mo_bot](https://t.me/eregistratura_mo_bot): места разбирают за минуты
- Часто новые окна открывают **утром** — имеет смысл держать монитор включённым ночью и с утра
- Если API портала сменится, команды `departments` / `doctors` начнут падать с ошибкой HTTP — тогда нужно обновить URL в `monitor.py`

## Команды

| Команда | Что делает |
|--------|------------|
| `departments` | Специальности |
| `hospitals [id]` | ЛПУ по специальности |
| `doctors [id] [lpu]` | Врачи и талоны |
| `check` | Одна проверка + уведомление |
| `watch` | Цикл каждые N секунд |
| `notify-test` | Тест Telegram |
